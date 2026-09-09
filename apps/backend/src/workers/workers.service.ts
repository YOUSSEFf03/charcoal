import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CreateWorkerDto } from './dto/create-worker.dto';
import { UpdateWorkerDto } from './dto/update-worker.dto';
import { SetRatesDto } from './dto/set-rates.dto';
import { CreateWorkerPaymentDto } from './dto/create-worker-payment.dto';
import { CreateWorkerEarningDto } from './dto/create-worker-earning.dto';
import { UpdateWorkerEarningDto } from './dto/update-worker-earning.dto';
import { LogDailyWageDto } from './dto/log-daily-wage.dto';

// Worker.totalEarned / totalBagsPacked / totalPaid are DEPRECATED CACHE columns.
// They are never written by packing-session create/update and never read as source of truth.
// Source of truth: PackingSession.sessionEarnings (where workerEntityId = worker.id),
//                  WorkerCost.amount (where workerId = worker.id),
//                  and WorkerPayment.amount (where workerId = worker.id).
//
// WorkerAttendance/dailyRate (the old calendar-based daily-wage mechanism) have
// been fully replaced by WorkerCost — all historical attendance was backfilled
// into WorkerCost rows (category `daily_wage`) and verified to match before the
// WorkerAttendance table and Worker.dailyRate column were dropped. See the
// employee module redesign migrations around 2026-07-29.

// A WorkerCost row can be edited only within this window of its creation.
// Past it, corrections must be a new entry (category `correction`), never a
// rewrite of history — see the WorkerCost model comment in schema.prisma.
const EARNING_EDIT_WINDOW_HOURS = 24;

@Injectable()
export class WorkersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * Compute live earned/paid/owed totals for a single worker.
   * totalEarned = pieceEarned (Σ sessionEarnings) + costEarned (Σ WorkerCost.amount).
   */
  private async computeTotals(workerId: string) {
    const [earnedResult, paidResult, costResult] = await Promise.all([
      this.prisma.packingSession.aggregate({
        where: { workerEntityId: workerId },
        _sum: { sessionEarnings: true },
      }),
      this.prisma.workerPayment.aggregate({
        where: { workerId },
        _sum: { amount: true },
      }),
      this.prisma.workerCost.aggregate({
        where: { workerId },
        _sum: { amount: true },
      }),
    ]);

    const pieceEarned  = new Decimal(earnedResult._sum.sessionEarnings?.toString() ?? '0');
    const costEarned   = new Decimal(costResult._sum.amount?.toString() ?? '0');
    const totalEarned  = pieceEarned.plus(costEarned);
    const totalPaid    = new Decimal(paidResult._sum.amount?.toString() ?? '0');

    return {
      pieceEarned: pieceEarned.toFixed(2),
      costEarned:  costEarned.toFixed(2),
      totalEarned: totalEarned.toFixed(2),
      totalPaid:   totalPaid.toFixed(2),
      totalOwed:   totalEarned.minus(totalPaid).toFixed(2),
    };
  }

  /**
   * Paginated worker list with computed totals (no N+1 — batch aggregations).
   */
  async findAll(page: number, limit: number) {
    const skip = (page - 1) * limit;

    const [workers, total] = await this.prisma.$transaction([
      this.prisma.worker.findMany({ skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.worker.count(),
    ]);

    if (workers.length === 0) return { data: [], total, page, limit };

    const workerIds = workers.map(w => w.id);

    const [earnedAgg, paidAgg, costAgg] = await Promise.all([
      this.prisma.packingSession.groupBy({
        by: ['workerEntityId'],
        where: { workerEntityId: { in: workerIds } },
        _sum: { sessionEarnings: true },
      }),
      this.prisma.workerPayment.groupBy({
        by: ['workerId'],
        where: { workerId: { in: workerIds } },
        _sum: { amount: true },
      }),
      this.prisma.workerCost.groupBy({
        by: ['workerId'],
        where: { workerId: { in: workerIds } },
        _sum: { amount: true },
      }),
    ]);

    const earnedMap = new Map(earnedAgg.map(r => [r.workerEntityId, r._sum.sessionEarnings]));
    const paidMap   = new Map(paidAgg.map(r => [r.workerId, r._sum.amount]));
    const costMap   = new Map(costAgg.map(r => [r.workerId, r._sum.amount]));

    const data = workers.map(w => {
      const pieceEarned = new Decimal(earnedMap.get(w.id)?.toString() ?? '0');
      const costEarned  = new Decimal(costMap.get(w.id)?.toString() ?? '0');
      const totalEarned = pieceEarned.plus(costEarned);
      const totalPaid   = new Decimal(paidMap.get(w.id)?.toString() ?? '0');
      return {
        ...w,
        pieceEarned: pieceEarned.toFixed(2),
        costEarned:  costEarned.toFixed(2),
        totalEarned: totalEarned.toFixed(2),
        totalPaid:   totalPaid.toFixed(2),
        totalOwed:   totalEarned.minus(totalPaid).toFixed(2),
      };
    });

    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const worker = await this.prisma.worker.findUnique({ where: { id } });
    if (!worker) throw new NotFoundException({ error: 'Worker not found', code: 'NOT_FOUND' });
    const totals = await this.computeTotals(id);
    return { ...worker, ...totals };
  }

  /**
   * Every worker is created with a linked, local (non-Clerk) User account —
   * same synthetic-account convention as UsersService.createLocal() — so the
   * worker has a real receiverId a Payment can reference. Without this, a
   * cash payment collected by a worker had no valid User id to credit, and
   * the frontend receiver picker silently dropped it (see the
   * 20260821000000_add_worker_user_link migration for the full history and
   * the backfill of workers that pre-date this).
   */
  async create(dto: CreateWorkerDto) {
    return this.prisma.$transaction(async (tx) => {
      const syntheticClerkId = `local_${crypto.randomUUID()}`;
      const user = await tx.user.create({
        data: {
          clerkId: syntheticClerkId,
          email: `${syntheticClerkId}@local.internal`,
          name: dto.name,
          role: 'worker',
          ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        },
      });
      return tx.worker.create({
        data: {
          name: dto.name,
          ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
          ratesPerBagType: (dto.ratesPerBagType ?? []) as unknown as Prisma.InputJsonValue,
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          userId: user.id,
        },
      });
    });
  }

  async update(id: string, dto: UpdateWorkerDto) {
    await this.findOne(id);
    return this.prisma.worker.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });
  }

  async setRates(id: string, dto: SetRatesDto) {
    await this.findOne(id);
    return this.prisma.worker.update({
      where: { id },
      data: { ratesPerBagType: dto.ratesPerBagType as unknown as Prisma.InputJsonValue },
    });
  }

  /**
   * @param dateFrom - Optional inclusive lower bound on WorkerPayment.date
   * @param dateTo   - Optional inclusive upper bound on WorkerPayment.date
   *
   * The date filter is used by the Expenses page's Employee Payments tab
   * (see useAllWorkerPayments) to fetch exactly one worker's payments for
   * the selected month, server-side — avoiding the correctness risk of
   * fetching a fixed-size recent page and slicing it by date client-side
   * (a worker with more all-time payments than that page size could
   * silently lose older-in-page, in-range rows).
   */
  async listPayments(id: string, page: number, limit: number, dateFrom?: string, dateTo?: string) {
    await this.findOne(id);
    const skip = (page - 1) * limit;
    const where: Prisma.WorkerPaymentWhereInput = {
      workerId: id,
      ...(dateFrom || dateTo
        ? {
            date: {
              ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
              ...(dateTo ? { lte: new Date(dateTo) } : {}),
            },
          }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.workerPayment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { date: 'desc' },
      }),
      this.prisma.workerPayment.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async addPayment(id: string, dto: CreateWorkerPaymentDto) {
    const worker = await this.prisma.worker.findUnique({ where: { id } });
    if (!worker) throw new NotFoundException({ error: 'Worker not found', code: 'NOT_FOUND' });
    return this.prisma.workerPayment.create({
      data: {
        workerId: id,
        amount: dto.amount,
        date: dto.date ? new Date(dto.date) : new Date(),
        ...(dto.method ? { method: dto.method } : {}),
        ...(dto.referenceNumber ? { referenceNumber: dto.referenceNumber } : {}),
        ...(dto.notes ? { notes: dto.notes } : {}),
      },
    });
  }

  async getPayment(workerId: string, paymentId: string) {
    const payment = await this.prisma.workerPayment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.workerId !== workerId) {
      throw new NotFoundException({ error: 'Worker payment not found', code: 'NOT_FOUND' });
    }
    return payment;
  }

  /**
   * List earnings (WorkerCost rows) for a worker, paginated, newest first.
   */
  async listEarnings(id: string, page: number, limit: number) {
    await this.findOne(id);
    const skip = (page - 1) * limit;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.workerCost.findMany({
        where: { workerId: id },
        skip,
        take: limit,
        orderBy: { date: 'desc' },
      }),
      this.prisma.workerCost.count({ where: { workerId: id } }),
    ]);
    return { data, total, page, limit };
  }

  /**
   * Log an earning (WorkerCost row) for a worker.
   * createdById is always resolved server-side from the authenticated Clerk
   * user — never accepted from the request body — matching the convention
   * every other money-touching write in this codebase follows.
   */
  async createEarning(id: string, dto: CreateWorkerEarningDto, clerkUserId: string) {
    const worker = await this.prisma.worker.findUnique({ where: { id } });
    if (!worker) throw new NotFoundException({ error: 'Worker not found', code: 'NOT_FOUND' });

    const user = await this.prisma.user.findUnique({ where: { clerkId: clerkUserId } });
    if (!user) throw new ForbiddenException({ error: 'User not synced', code: 'NO_USER' });

    return this.prisma.workerCost.create({
      data: {
        workerId: id,
        amount: dto.amount,
        category: dto.category,
        date: dto.date ? new Date(dto.date) : new Date(),
        createdById: user.id,
        ...(dto.notes ? { notes: dto.notes } : {}),
        ...(dto.fileId ? { fileId: dto.fileId } : {}),
      },
    });
  }

  async getEarning(workerId: string, earningId: string) {
    const earning = await this.prisma.workerCost.findUnique({ where: { id: earningId } });
    if (!earning || earning.workerId !== workerId) {
      throw new NotFoundException({ error: 'Worker earning not found', code: 'NOT_FOUND' });
    }
    return earning;
  }

  /**
   * Edit an earning — only within EARNING_EDIT_WINDOW_HOURS of its creation.
   * Past that window, callers must log a new entry with category `correction`
   * rather than rewrite history (see the WorkerCost model comment in
   * schema.prisma and the redesign's append-only design decision).
   */
  async updateEarning(workerId: string, earningId: string, dto: UpdateWorkerEarningDto) {
    const earning = await this.getEarning(workerId, earningId);

    const ageHours = (Date.now() - earning.createdAt.getTime()) / (1000 * 60 * 60);
    if (ageHours > EARNING_EDIT_WINDOW_HOURS) {
      throw new ForbiddenException({
        error: `Earning can only be edited within ${EARNING_EDIT_WINDOW_HOURS}h of creation — log a correction entry instead`,
        code: 'EDIT_WINDOW_EXPIRED',
      });
    }

    return this.prisma.workerCost.update({
      where: { id: earningId },
      data: {
        ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.date !== undefined ? { date: new Date(dto.date) } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.fileId !== undefined ? { fileId: dto.fileId } : {}),
      },
    });
  }

  /**
   * "Add daily wage" button (Employee Detail audit, 2026-09-05) — records
   * TODAY's daily wage for this worker using the SAME authoritative earning
   * mechanism as manual "Add earnings" (a WorkerCost row, category
   * `daily_wage`), never a fake frontend-only row. The amount always comes
   * from SettingsService.getDailyWageRate() (the single global figure —
   * see that method's doc comment) — the caller never supplies an amount.
   *
   * `dto.date` is the caller's OWN local-date string (same
   * toDateOnlyString(new Date()) convention every other manual entry in this
   * app already sends) — matches "today" as the rest of the app understands
   * it, rather than trusting the server's clock/timezone.
   *
   * Duplicate protection: one daily_wage entry per worker per calendar day.
   * There is no DB-level uniqueness constraint on WorkerCost(workerId, date,
   * category) — manual "Add earnings" intentionally allows logging multiple
   * entries of any category on the same day (e.g. a bonus AND a deduction on
   * the same date is legitimate). This method adds duplicate protection
   * ONLY for its own idempotent "one click = one day's wage" action, without
   * touching createEarning()'s existing, deliberately permissive behavior.
   */
  async logDailyWage(id: string, dto: LogDailyWageDto, clerkUserId: string) {
    const worker = await this.prisma.worker.findUnique({ where: { id } });
    if (!worker) throw new NotFoundException({ error: 'Worker not found', code: 'NOT_FOUND' });

    const rate = await this.settingsService.getDailyWageRate();
    if (!(rate > 0)) {
      throw new BadRequestException({
        error: 'Daily wage amount is not configured — set it in Settings first.',
        code: 'DAILY_WAGE_NOT_CONFIGURED',
      });
    }

    const user = await this.prisma.user.findUnique({ where: { clerkId: clerkUserId } });
    if (!user) throw new ForbiddenException({ error: 'User not synced', code: 'NO_USER' });

    const date = dto.date ? new Date(dto.date) : new Date(new Date().toISOString().slice(0, 10));

    const existing = await this.prisma.workerCost.findFirst({
      where: { workerId: id, category: 'daily_wage', date },
    });
    if (existing) {
      throw new ConflictException({
        error: 'Daily wage already recorded for today.',
        code: 'DAILY_WAGE_ALREADY_RECORDED',
      });
    }

    return this.prisma.workerCost.create({
      data: {
        workerId: id,
        amount: rate.toFixed(2),
        category: 'daily_wage',
        date,
        createdById: user.id,
      },
    });
  }

  /**
   * Statement of Account — chronological earning/payment ledger with a
   * running balance, mirroring ReportsService.getClientLedger()'s architecture
   * (openingBalance computed from everything strictly before dateFrom, so a
   * filtered period never shows a misleading fake-zero opening balance —
   * CONSTRAINT 15 equivalent: balance always computed from records, never
   * stored). Sources are the SAME authoritative records computeTotals()
   * already uses (PackingSession.sessionEarnings, WorkerCost.amount,
   * WorkerPayment.amount) — no second accounting calculation, no invented
   * transaction. Category/method/notes/referenceNumber are returned raw so
   * the frontend can format descriptions with the SAME label maps
   * Employees.tsx already uses elsewhere on this page (never a second,
   * possibly-divergent description implementation).
   */
  async getStatement(id: string, dateFrom?: string, dateTo?: string) {
    const worker = await this.prisma.worker.findUnique({ where: { id } });
    if (!worker) throw new NotFoundException({ error: 'Worker not found', code: 'NOT_FOUND' });

    const gte = dateFrom ? new Date(dateFrom) : undefined;
    const lte = dateTo ? new Date(dateTo) : undefined;

    let openingBalance = new Decimal(0);
    if (gte) {
      const [priorCost, priorSessions, priorPaid] = await Promise.all([
        this.prisma.workerCost.aggregate({ where: { workerId: id, date: { lt: gte } }, _sum: { amount: true } }),
        this.prisma.packingSession.aggregate({ where: { workerEntityId: id, date: { lt: gte } }, _sum: { sessionEarnings: true } }),
        this.prisma.workerPayment.aggregate({ where: { workerId: id, date: { lt: gte } }, _sum: { amount: true } }),
      ]);
      openingBalance = new Decimal(priorCost._sum.amount?.toString() ?? '0')
        .plus(new Decimal(priorSessions._sum.sessionEarnings?.toString() ?? '0'))
        .minus(new Decimal(priorPaid._sum.amount?.toString() ?? '0'));
    }

    const dateRange: Prisma.DateTimeFilter = { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
    const periodWhere = gte || lte ? { date: dateRange } : {};

    const [costs, sessions, payments] = await Promise.all([
      this.prisma.workerCost.findMany({ where: { workerId: id, ...periodWhere }, orderBy: { date: 'asc' } }),
      this.prisma.packingSession.findMany({ where: { workerEntityId: id, ...periodWhere }, orderBy: { date: 'asc' } }),
      this.prisma.workerPayment.findMany({ where: { workerId: id, ...periodWhere }, orderBy: { date: 'asc' } }),
    ]);

    type Item =
      | { kind: 'cost'; date: Date; id: string; amount: Decimal; category: string; notes: string | null }
      | { kind: 'session'; date: Date; id: string; amount: Decimal }
      | { kind: 'payment'; date: Date; id: string; amount: Decimal; method: string; referenceNumber: string | null; notes: string | null };

    const items: Item[] = [
      ...costs.map((c): Item => ({ kind: 'cost', date: c.date, id: c.id, amount: new Decimal(c.amount.toString()), category: c.category, notes: c.notes })),
      ...sessions.map((s): Item => ({ kind: 'session', date: s.date, id: s.id, amount: new Decimal(s.sessionEarnings.toString()) })),
      ...payments.map((p): Item => ({ kind: 'payment', date: p.date, id: p.id, amount: new Decimal(p.amount.toString()), method: p.method, referenceNumber: p.referenceNumber, notes: p.notes })),
    ];

    // Chronological; earnings (cost/session) before payments on the same date —
    // mirrors getClientLedger()'s invoice-before-payment tie-break.
    const isEarning = (kind: Item['kind']) => kind === 'cost' || kind === 'session';
    items.sort((a, b) => {
      const diff = a.date.getTime() - b.date.getTime();
      if (diff !== 0) return diff;
      if (isEarning(a.kind) && b.kind === 'payment') return -1;
      if (a.kind === 'payment' && isEarning(b.kind)) return 1;
      return 0;
    });

    let runningBalance = new Decimal(openingBalance);
    const entries = items.map((item) => {
      if (item.kind === 'cost') {
        runningBalance = runningBalance.plus(item.amount);
        return {
          date: item.date, type: 'earning' as const, source: 'cost' as const, reference: item.id,
          category: item.category, notes: item.notes,
          earned: item.amount.toFixed(2), paid: '0.00', runningBalance: runningBalance.toFixed(2),
        };
      }
      if (item.kind === 'session') {
        runningBalance = runningBalance.plus(item.amount);
        return {
          date: item.date, type: 'earning' as const, source: 'session' as const, reference: item.id,
          category: null, notes: null,
          earned: item.amount.toFixed(2), paid: '0.00', runningBalance: runningBalance.toFixed(2),
        };
      }
      runningBalance = runningBalance.minus(item.amount);
      return {
        date: item.date, type: 'payment' as const, source: 'payment' as const, reference: item.id,
        method: item.method, referenceNumber: item.referenceNumber, notes: item.notes,
        earned: '0.00', paid: item.amount.toFixed(2), runningBalance: runningBalance.toFixed(2),
      };
    });

    return {
      workerId: id,
      openingBalance: openingBalance.toFixed(2),
      entries,
      balance: runningBalance.toFixed(2),
    };
  }

  /**
   * Employee Performance analytics (Employee Profile audit, 2026-09-07).
   *
   * Authoritative sources — no duplicate accounting/performance records:
   *   - Bags packed / bag type / quantity / per-bag rate / session earnings all
   *     come from PackingSession.bagsOutput, a JSON array of
   *     { bagTypeId, qty, ratePerBag } SNAPSHOTTED at session create/update
   *     time (see PackingSessionsService, step 9) — a later BagType.workerRate
   *     or Worker.ratesPerBagType change can never reprice a past session.
   *     This is the ONLY source read for quantity/rate/earnings here — never
   *     Worker.totalBagsPacked, a deprecated cache column that is never
   *     written post-migration (see the file-level comment above).
   *   - "Working day" = a DISTINCT PackingSession.date (a @db.Date column —
   *     no time component) on which the worker has at least one session in
   *     the period. Two sessions on the same date count as ONE working day,
   *     both overall and per bag type.
   *   - Daily wage (WorkerCost, category='daily_wage') and WorkerPayment are
   *     completely separate from packing performance — never inferred from
   *     working days or bags packed.
   *   - "Rate/bag" per bag type is earned÷bags computed from the REAL
   *     snapshotted ratePerBag × qty pairs actually used in the period —
   *     never a fabricated market rate. When every session used the same
   *     rate for that bag type this is exactly that configured rate; if the
   *     rate changed mid-period (rateVaries: true), it is the true
   *     qty-weighted average of the actual rates applied, still built
   *     entirely from real per-line snapshots.
   *
   * Scalability: dateFrom/dateTo bound the PackingSession/WorkerCost/
   * WorkerPayment queries exactly like getStatement()'s period query. The
   * aggregated `totals` and `byBagType` are always safe to return (a handful
   * of numbers) even for an unbounded "all time" request, but the two
   * row-level lists (dailyPerformance, packingHistory) and dailyWages are
   * only populated for a bounded period — an "all time" request never ships
   * years of individual session/day/wage rows to the browser.
   */
  async getPerformance(id: string, dateFrom?: string, dateTo?: string) {
    const worker = await this.prisma.worker.findUnique({ where: { id } });
    if (!worker) throw new NotFoundException({ error: 'Worker not found', code: 'NOT_FOUND' });

    const gte = dateFrom ? new Date(dateFrom) : undefined;
    const lte = dateTo ? new Date(dateTo) : undefined;
    const bounded = Boolean(gte || lte);
    const dateRange: Prisma.DateTimeFilter = { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
    const periodWhere = bounded ? { date: dateRange } : {};

    const [sessions, dailyWageRows, paymentsAgg] = await Promise.all([
      this.prisma.packingSession.findMany({
        where: { workerEntityId: id, ...periodWhere },
        select: { id: true, date: true, bagsOutput: true },
        orderBy: { date: 'asc' },
      }),
      this.prisma.workerCost.findMany({
        where: { workerId: id, category: 'daily_wage', ...periodWhere },
        select: { id: true, date: true, amount: true },
        orderBy: { date: 'asc' },
      }),
      this.prisma.workerPayment.aggregate({
        where: { workerId: id, ...periodWhere },
        _sum: { amount: true },
      }),
    ]);

    type BagLine = { bagTypeId: string; qty: number; ratePerBag?: string };
    type TypeAcc = { bags: number; earned: Decimal; rates: Set<string>; days: Set<string> };
    type DayAcc = { bags: number; sessions: number; earned: Decimal };

    let totalBags = 0;
    let totalEarnings = new Decimal(0);
    const workingDaySet = new Set<string>();
    const byType = new Map<string, TypeAcc>();
    const dailyMap = new Map<string, DayAcc>();
    const packingHistory: Array<{
      date: string; sessionId: string; bagTypeId: string;
      quantity: number; ratePerBag: string; earned: string;
    }> = [];

    for (const s of sessions) {
      const dateKey = s.date.toISOString().slice(0, 10);
      workingDaySet.add(dateKey);
      const lines = (s.bagsOutput ?? []) as BagLine[];
      const dayAcc = dailyMap.get(dateKey) ?? { bags: 0, sessions: 0, earned: new Decimal(0) };
      dayAcc.sessions += 1;

      for (const line of lines) {
        const qty = line.qty;
        // Legacy sessions predating rate-snapshotting may have no ratePerBag
        // on a line — no authoritative historical rate exists for those, so
        // they contribute bags/working-days but $0 to earned (never a
        // fabricated current-rate guess).
        const rate = new Decimal(line.ratePerBag ?? '0');
        const earned = rate.mul(qty);

        totalBags += qty;
        totalEarnings = totalEarnings.plus(earned);
        dayAcc.bags += qty;
        dayAcc.earned = dayAcc.earned.plus(earned);

        const typeAcc = byType.get(line.bagTypeId) ?? { bags: 0, earned: new Decimal(0), rates: new Set<string>(), days: new Set<string>() };
        typeAcc.bags += qty;
        typeAcc.earned = typeAcc.earned.plus(earned);
        if (line.ratePerBag) typeAcc.rates.add(new Decimal(line.ratePerBag).toFixed(4));
        typeAcc.days.add(dateKey);
        byType.set(line.bagTypeId, typeAcc);

        packingHistory.push({
          date: dateKey, sessionId: s.id, bagTypeId: line.bagTypeId,
          quantity: qty, ratePerBag: rate.toFixed(4), earned: earned.toFixed(2),
        });
      }
      dailyMap.set(dateKey, dayAcc);
    }

    const sessionsCount = sessions.length;
    const workingDays = workingDaySet.size;

    const bagTypeIds = Array.from(byType.keys());
    const bagTypes = bagTypeIds.length
      ? await this.prisma.bagType.findMany({ where: { id: { in: bagTypeIds } } })
      : [];
    const bagTypeNameById = new Map(bagTypes.map(bt => [bt.id, bt.name]));

    const packingHistoryWithNames = packingHistory.map(row => ({
      ...row,
      bagTypeName: bagTypeNameById.get(row.bagTypeId) ?? 'Unknown bag type',
    }));

    const byBagType = Array.from(byType.entries())
      .map(([bagTypeId, v]) => ({
        bagTypeId,
        bagTypeName: bagTypeNameById.get(bagTypeId) ?? 'Unknown bag type',
        bags: v.bags,
        // Qty-weighted average of the REAL per-line snapshotted rates — equals
        // the single configured rate whenever it didn't change mid-period.
        ratePerBag: v.bags > 0 ? v.earned.div(v.bags).toFixed(4) : '0.0000',
        rateVaries: v.rates.size > 1,
        earned: v.earned.toFixed(2),
        workingDays: v.days.size,
        avgBagsPerWorkingDay: v.days.size > 0 ? (v.bags / v.days.size).toFixed(2) : null,
      }))
      .sort((a, b) => b.bags - a.bags);

    const dailyPerformance = Array.from(dailyMap.entries())
      .map(([date, v]) => ({ date, bagsPacked: v.bags, sessions: v.sessions, earned: v.earned.toFixed(2) }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      workerId: id,
      from: dateFrom ?? null,
      to: dateTo ?? null,
      totals: {
        bagsPacked: totalBags,
        sessions: sessionsCount,
        workingDays,
        packingEarnings: totalEarnings.toFixed(2),
        avgBagsPerWorkingDay: workingDays > 0 ? (totalBags / workingDays).toFixed(2) : null,
        avgBagsPerSession: sessionsCount > 0 ? (totalBags / sessionsCount).toFixed(2) : null,
        avgEarningsPerWorkingDay: workingDays > 0 ? totalEarnings.div(workingDays).toFixed(2) : null,
        avgEarningsPerSession: sessionsCount > 0 ? totalEarnings.div(sessionsCount).toFixed(2) : null,
      },
      byBagType,
      // Row-level detail — only for a bounded period (see doc comment above).
      dailyPerformance: bounded ? dailyPerformance : null,
      packingHistory: bounded ? packingHistoryWithNames : null,
      dailyWages: bounded ? dailyWageRows.map(w => ({ id: w.id, date: w.date.toISOString().slice(0, 10), amount: new Decimal(w.amount.toString()).toFixed(2) })) : null,
      // A single aggregate — always safe to return regardless of period.
      paymentsTotal: new Decimal(paymentsAgg._sum.amount?.toString() ?? '0').toFixed(2),
    };
  }

  /**
   * Delete a worker permanently, along with their WorkerPayment/WorkerCost history.
   *
   * A worker with a non-zero outstanding balance (owed to them, or overpaid) must
   * never be deleted through this path — doing so would silently and irrecoverably
   * destroy their earnings/payment audit trail with no way to recover it, and the
   * balance itself would simply vanish from the books. Same live totalOwed
   * computation (computeTotals) already used by findOne()/findAll() — mirrors the
   * same balance-read-before-delete pattern UsersService.deleteLocal() already
   * uses for local receivers.
   */
  async remove(id: string): Promise<void> {
    const worker = await this.prisma.worker.findUnique({ where: { id } });
    if (!worker) throw new NotFoundException({ error: 'Worker not found', code: 'NOT_FOUND' });

    const { totalOwed } = await this.computeTotals(id);
    if (!new Decimal(totalOwed).isZero()) {
      throw new BadRequestException({
        error: `Cannot delete this worker — they have an outstanding balance of $${totalOwed}. Settle the balance before deleting.`,
        code: 'OUTSTANDING_BALANCE',
      });
    }

    await this.prisma.workerPayment.deleteMany({ where: { workerId: id } });
    // WorkerCost.workerId is ON DELETE RESTRICT (unlike WorkerAttendance, which
    // cascades) — must clear these explicitly or worker.delete() below violates
    // the FK constraint.
    await this.prisma.workerCost.deleteMany({ where: { workerId: id } });
    await this.prisma.worker.delete({ where: { id } });
  }
}
