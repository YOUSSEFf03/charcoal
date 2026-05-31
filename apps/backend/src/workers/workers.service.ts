import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Worker } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWorkerDto } from './dto/create-worker.dto';
import { UpdateWorkerDto } from './dto/update-worker.dto';
import { SetRatesDto } from './dto/set-rates.dto';
import { CreateWorkerPaymentDto } from './dto/create-worker-payment.dto';

@Injectable()
export class WorkersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Compute totalOwed = totalEarned − totalPaid via decimal.js.
   * Never stored — always computed on read.
   */
  private computeTotalOwed(worker: Worker): string {
    return new Decimal(worker.totalEarned.toString())
      .minus(new Decimal(worker.totalPaid.toString()))
      .toFixed(2);
  }

  /**
   * Return a paginated list of workers with computed totalOwed.
   *
   * @param page - 1-indexed page number
   * @param limit - Items per page
   */
  async findAll(page: number, limit: number) {
    const skip = (page - 1) * limit;

    const [workers, total] = await this.prisma.$transaction([
      this.prisma.worker.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.worker.count(),
    ]);

    const data = workers.map((w) => ({ ...w, totalOwed: this.computeTotalOwed(w) }));

    return { data, total, page, limit };
  }

  /**
   * Return a single worker with computed totalOwed.
   *
   * @param id - Worker UUID
   * @throws NotFoundException if not found
   */
  async findOne(id: string) {
    const worker = await this.prisma.worker.findUnique({ where: { id } });
    if (!worker) {
      throw new NotFoundException({ error: 'Worker not found', code: 'NOT_FOUND' });
    }
    return { ...worker, totalOwed: this.computeTotalOwed(worker) };
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
   * Pay a worker and atomically increment totalPaid.
   * Step 1: Fetch worker (404 if not found)
   * Step 2: Create WorkerPayment record
   * Step 3: Increment worker.totalPaid using decimal.js (never native arithmetic)
   */
  async addPayment(id: string, dto: CreateWorkerPaymentDto) {
    return this.prisma.$transaction(async (tx) => {
      const worker = await tx.worker.findUnique({ where: { id } });
      if (!worker) {
        throw new NotFoundException({ error: 'Worker not found', code: 'NOT_FOUND' });
      }

      const payment = await tx.workerPayment.create({
        data: {
          workerId: id,
          amount: dto.amount,
          date: dto.date ? new Date(dto.date) : new Date(),
          ...(dto.notes ? { notes: dto.notes } : {}),
        },
      });

      const newTotalPaid = new Decimal(worker.totalPaid.toString())
        .plus(dto.amount)
        .toFixed(2);

      await tx.worker.update({
        where: { id },
        data: { totalPaid: newTotalPaid },
      });

      return payment;
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
