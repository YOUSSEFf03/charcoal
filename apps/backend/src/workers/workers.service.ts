import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWorkerDto } from './dto/create-worker.dto';
import { UpdateWorkerDto } from './dto/update-worker.dto';
import { SetRatesDto } from './dto/set-rates.dto';
import { CreateWorkerPaymentDto } from './dto/create-worker-payment.dto';
import { CreateWorkerEarningDto } from './dto/create-worker-earning.dto';
import { UpdateWorkerEarningDto } from './dto/update-worker-earning.dto';

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
  constructor(private readonly prisma: PrismaService) {}

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

  async create(dto: CreateWorkerDto) {
    return this.prisma.worker.create({
      data: {
        name: dto.name,
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ratesPerBagType: (dto.ratesPerBagType ?? []) as unknown as Prisma.InputJsonValue,
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
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

  async listPayments(id: string, page: number, limit: number) {
    await this.findOne(id);
    const skip = (page - 1) * limit;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.workerPayment.findMany({
        where: { workerId: id },
        skip,
        take: limit,
        orderBy: { date: 'desc' },
      }),
      this.prisma.workerPayment.count({ where: { workerId: id } }),
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
