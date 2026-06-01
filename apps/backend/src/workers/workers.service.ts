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

// Worker.totalEarned / totalBagsPacked / totalPaid are DEPRECATED CACHE columns.
// They are never written by packing-session create/update and never read as source of truth.
// Source of truth: PackingSession.sessionEarnings (where workerEntityId = worker.id)
//                  and WorkerPayment.amount (where workerId = worker.id).

@Injectable()
export class WorkersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Compute live earned/paid/owed totals for a single worker from source records.
   * Uses Decimal arithmetic throughout — no native number math on money.
   */
  private async computeTotals(workerId: string) {
    const [earnedResult, paidResult] = await Promise.all([
      this.prisma.packingSession.aggregate({
        where: { workerEntityId: workerId },
        _sum: { sessionEarnings: true },
      }),
      this.prisma.workerPayment.aggregate({
        where: { workerId },
        _sum: { amount: true },
      }),
    ]);

    const totalEarned = new Decimal(earnedResult._sum.sessionEarnings?.toString() ?? '0');
    const totalPaid   = new Decimal(paidResult._sum.amount?.toString() ?? '0');
    return {
      totalEarned: totalEarned.toFixed(2),
      totalPaid:   totalPaid.toFixed(2),
      totalOwed:   totalEarned.minus(totalPaid).toFixed(2),
    };
  }

  /**
   * Return a paginated list of workers with computed totals.
   * Uses two grouped aggregation queries (not N queries) after the main list fetch.
   */
  async findAll(page: number, limit: number) {
    const skip = (page - 1) * limit;

    const [workers, total] = await this.prisma.$transaction([
      this.prisma.worker.findMany({ skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.worker.count(),
    ]);

    if (workers.length === 0) return { data: [], total, page, limit };

    const workerIds = workers.map(w => w.id);

    const [earnedAgg, paidAgg] = await Promise.all([
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
    ]);

    const earnedMap = new Map(earnedAgg.map(r => [r.workerEntityId, r._sum.sessionEarnings]));
    const paidMap   = new Map(paidAgg.map(r => [r.workerId, r._sum.amount]));

    const data = workers.map(w => {
      const earned = new Decimal(earnedMap.get(w.id)?.toString() ?? '0');
      const paid   = new Decimal(paidMap.get(w.id)?.toString() ?? '0');
      return {
        ...w,
        totalEarned: earned.toFixed(2),
        totalPaid:   paid.toFixed(2),
        totalOwed:   earned.minus(paid).toFixed(2),
      };
    });

    return { data, total, page, limit };
  }

  /**
   * Return a single worker with live-computed totalEarned / totalPaid / totalOwed.
   */
  async findOne(id: string) {
    const worker = await this.prisma.worker.findUnique({ where: { id } });
    if (!worker) throw new NotFoundException({ error: 'Worker not found', code: 'NOT_FOUND' });
    const totals = await this.computeTotals(id);
    return { ...worker, ...totals };
  }

  /**
   * Create a new worker.
   *
   * @param dto - Worker creation data
   */
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

  /**
   * Update a worker's name, phone, and notes.
   * ratesPerBagType is managed via setRates.
   *
   * @param id - Worker UUID
   * @param dto - Partial update data
   * @throws NotFoundException if worker not found
   */
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

  /**
   * Replace the entire ratesPerBagType array.
   * This is a full replacement — existing rates are overwritten, not appended.
   */
  async setRates(id: string, dto: SetRatesDto) {
    await this.findOne(id);

    return this.prisma.worker.update({
      where: { id },
      data: {
        ratesPerBagType: dto.ratesPerBagType as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Return a paginated list of payments for a worker.
   *
   * @param id - Worker UUID
   * @param page - 1-indexed page number
   * @param limit - Items per page
   * @throws NotFoundException if worker not found
   */
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

  /**
   * Pay a worker — creates a WorkerPayment record.
   * totalPaid is computed on read from WorkerPayment rows; no stored counter to update.
   * No transaction needed: guard read + single write have no atomicity requirement.
   */
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

  /**
   * Get a single worker payment by workerId and paymentId.
   *
   * @param workerId - Worker UUID
   * @param paymentId - WorkerPayment UUID
   * @throws NotFoundException if not found or workerId mismatch
   */
  async getPayment(workerId: string, paymentId: string) {
    const payment = await this.prisma.workerPayment.findUnique({
      where: { id: paymentId },
    });

    if (!payment || payment.workerId !== workerId) {
      throw new NotFoundException({ error: 'Worker payment not found', code: 'NOT_FOUND' });
    }

    return payment;
  }

  async remove(id: string): Promise<void> {
    const worker = await this.prisma.worker.findUnique({ where: { id } });
    if (!worker) {
      throw new NotFoundException({ error: 'Worker not found', code: 'NOT_FOUND' });
    }
    // Delete payments first, then worker
    await this.prisma.workerPayment.deleteMany({ where: { workerId: id } });
    await this.prisma.worker.delete({ where: { id } });
  }
}
