import {
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
import { CreateWorkerAttendanceDto } from './dto/create-worker-attendance.dto';

// Worker.totalEarned / totalBagsPacked / totalPaid are DEPRECATED CACHE columns.
// They are never written by packing-session create/update and never read as source of truth.
// Source of truth: PackingSession.sessionEarnings (where workerEntityId = worker.id),
//                  WorkerAttendance rows × worker.dailyRate,
//                  and WorkerPayment.amount (where workerId = worker.id).

@Injectable()
export class WorkersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Compute live earned/paid/owed totals for a single worker.
   * totalEarned = pieceEarned (Σ sessionEarnings) + dailyEarned (attendanceDays × dailyRate).
   * Caller supplies dailyRate so this method needs no extra DB round-trip.
   */
  private async computeTotals(workerId: string, dailyRate: Decimal) {
    const [earnedResult, paidResult, attendanceCount] = await Promise.all([
      this.prisma.packingSession.aggregate({
        where: { workerEntityId: workerId },
        _sum: { sessionEarnings: true },
      }),
      this.prisma.workerPayment.aggregate({
        where: { workerId },
        _sum: { amount: true },
      }),
      this.prisma.workerAttendance.count({ where: { workerId } }),
    ]);

    const pieceEarned  = new Decimal(earnedResult._sum.sessionEarnings?.toString() ?? '0');
    const dailyEarned  = dailyRate.times(attendanceCount);
    const totalEarned  = pieceEarned.plus(dailyEarned);
    const totalPaid    = new Decimal(paidResult._sum.amount?.toString() ?? '0');

    return {
      pieceEarned:    pieceEarned.toFixed(2),
      dailyEarned:    dailyEarned.toFixed(2),
      totalEarned:    totalEarned.toFixed(2),
      totalPaid:      totalPaid.toFixed(2),
      totalOwed:      totalEarned.minus(totalPaid).toFixed(2),
      attendanceDays: attendanceCount,
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

    const [earnedAgg, paidAgg, attendanceAgg] = await Promise.all([
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
      this.prisma.workerAttendance.groupBy({
        by: ['workerId'],
        where: { workerId: { in: workerIds } },
        _count: { id: true },
      }),
    ]);

    const earnedMap     = new Map(earnedAgg.map(r => [r.workerEntityId, r._sum.sessionEarnings]));
    const paidMap       = new Map(paidAgg.map(r => [r.workerId, r._sum.amount]));
    const attendanceMap = new Map(attendanceAgg.map(r => [r.workerId, r._count.id]));

    const data = workers.map(w => {
      const dailyRate    = new Decimal(w.dailyRate?.toString() ?? '0');
      const attendCount  = attendanceMap.get(w.id) ?? 0;
      const pieceEarned  = new Decimal(earnedMap.get(w.id)?.toString() ?? '0');
      const dailyEarned  = dailyRate.times(attendCount);
      const totalEarned  = pieceEarned.plus(dailyEarned);
      const totalPaid    = new Decimal(paidMap.get(w.id)?.toString() ?? '0');
      return {
        ...w,
        pieceEarned:    pieceEarned.toFixed(2),
        dailyEarned:    dailyEarned.toFixed(2),
        totalEarned:    totalEarned.toFixed(2),
        totalPaid:      totalPaid.toFixed(2),
        totalOwed:      totalEarned.minus(totalPaid).toFixed(2),
        attendanceDays: attendCount,
      };
    });

    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const worker = await this.prisma.worker.findUnique({ where: { id } });
    if (!worker) throw new NotFoundException({ error: 'Worker not found', code: 'NOT_FOUND' });
    const dailyRate = new Decimal(worker.dailyRate?.toString() ?? '0');
    const totals = await this.computeTotals(id, dailyRate);
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
        ...(dto.dailyRate !== undefined ? { dailyRate: dto.dailyRate } : {}),
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
   * List attendance dates for a worker, optionally filtered to a month.
   * @param month - "YYYY-MM" string (optional); returns all dates if omitted
   */
  async listAttendance(id: string, month?: string) {
    await this.findOne(id);

    let dateFilter: Prisma.WorkerAttendanceWhereInput = { workerId: id };
    if (month) {
      const [year, mon] = month.split('-').map(Number);
      const from = new Date(year, mon - 1, 1);
      const to   = new Date(year, mon, 1); // exclusive
      dateFilter = { workerId: id, date: { gte: from, lt: to } };
    }

    const rows = await this.prisma.workerAttendance.findMany({
      where: dateFilter,
      orderBy: { date: 'asc' },
    });

    return rows.map(r => ({
      id:   r.id,
      date: r.date.toISOString().slice(0, 10),
    }));
  }

  /**
   * Mark a day attended (idempotent — returns existing record if already present).
   */
  async markAttendance(id: string, dto: CreateWorkerAttendanceDto) {
    const worker = await this.prisma.worker.findUnique({ where: { id } });
    if (!worker) throw new NotFoundException({ error: 'Worker not found', code: 'NOT_FOUND' });

    const date = new Date(dto.date);
    const existing = await this.prisma.workerAttendance.findUnique({
      where: { workerId_date: { workerId: id, date } },
    });
    if (existing) return { id: existing.id, date: existing.date.toISOString().slice(0, 10) };

    const record = await this.prisma.workerAttendance.create({
      data: { workerId: id, date },
    });
    return { id: record.id, date: record.date.toISOString().slice(0, 10) };
  }

  /**
   * Unmark a day (delete the attendance record). No-op if not present.
   */
  async unmarkAttendance(id: string, date: string) {
    const worker = await this.prisma.worker.findUnique({ where: { id } });
    if (!worker) throw new NotFoundException({ error: 'Worker not found', code: 'NOT_FOUND' });

    await this.prisma.workerAttendance.deleteMany({
      where: { workerId: id, date: new Date(date) },
    });
  }

  async remove(id: string): Promise<void> {
    const worker = await this.prisma.worker.findUnique({ where: { id } });
    if (!worker) throw new NotFoundException({ error: 'Worker not found', code: 'NOT_FOUND' });
    await this.prisma.workerPayment.deleteMany({ where: { workerId: id } });
    await this.prisma.worker.delete({ where: { id } });
  }
}
