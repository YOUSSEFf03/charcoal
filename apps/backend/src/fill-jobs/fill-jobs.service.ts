import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFillJobDto } from './dto/create-fill-job.dto';

interface StoredBagOutput {
  specKey: string;
  size: number;
  charcoal: string;
  qty: number;
  fillPricePerBag: number;
}

const FILL_JOB_INCLUDE = {
  workerEntity: { select: { id: true, name: true } },
  fillJobLots: { include: { lot: { select: { id: true, charcoalType: true, grade: true } } } },
} as const;

@Injectable()
export class FillJobsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(clientId: string, page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.fillJob.findMany({
        where: { clientId },
        skip,
        take: limit,
        orderBy: { date: 'desc' },
        include: FILL_JOB_INCLUDE,
      }),
      this.prisma.fillJob.count({ where: { clientId } }),
    ]);
    return { data, total, page, limit };
  }

  /**
   * Returns per-spec avg and last fill price for a client.
   * Result: { [specKey]: { avgFillPrice: number, lastFillPrice: number } }
   */
  async getPriceStats(clientId: string) {
    const jobs = await this.prisma.fillJob.findMany({
      where: { clientId },
      orderBy: { date: 'asc' },
      select: { date: true, bagOutputs: true },
    });

    const specData: Record<string, { prices: number[]; lastPrice: number }> = {};

    for (const job of jobs) {
      const outputs = job.bagOutputs as unknown as StoredBagOutput[];
      for (const out of outputs) {
        if (!specData[out.specKey]) {
          specData[out.specKey] = { prices: [], lastPrice: 0 };
        }
        specData[out.specKey].prices.push(out.fillPricePerBag);
        specData[out.specKey].lastPrice = out.fillPricePerBag;
      }
    }

    return Object.fromEntries(
      Object.entries(specData).map(([specKey, d]) => [
        specKey,
        {
          avgFillPrice: d.prices.reduce((s, p) => s + p, 0) / d.prices.length,
          lastFillPrice: d.lastPrice,
        },
      ]),
    );
  }

  /**
   * Create a fill job in a single atomic transaction.
   *
   * Steps:
   *   1. Fetch all referenced StockLots (404 if any missing)
   *   2. Validate kgUsed ≤ kgRemaining for each lot
   *   3. Compute costs from lot.costPerKg (snapshot at fill time)
   *   4. Compute fill price per bag = totalCost × bagSize / totalOutputKg
   *   5. Deduct kgUsed from each lot's kgRemaining
   *   6. Create FillJob record
   *   7. Create FillJobLot junction rows (one per charcoal input)
   *   8. Return job with fill lots included
   */
  async create(dto: CreateFillJobDto) {
    const fillJobId = await this.prisma.$transaction(async (tx) => {
      // Step 1: Fetch all referenced lots
      const lotIds = dto.charcoalInputs.map((i) => i.lotId);
      const lots = await tx.stockLot.findMany({ where: { id: { in: lotIds } } });
      const lotMap = new Map(lots.map((l) => [l.id, l]));

      // Step 2: Validate stock availability
      for (const inp of dto.charcoalInputs) {
        if (!lotMap.has(inp.lotId)) {
          throw new NotFoundException({ error: `Stock lot not found: ${inp.lotId}`, code: 'NOT_FOUND' });
        }
        const lot = lotMap.get(inp.lotId)!;
        const available = parseFloat(lot.kgRemaining.toString());
        if (inp.kg > available) {
          throw new BadRequestException({
            error: `Insufficient stock in lot — available: ${available} kg, requested: ${inp.kg} kg`,
            code: 'CONSTRAINT_VIOLATION',
          });
        }
      }

      // Step 3: Compute per-lot costs (snapshot costPerKg from the lot at fill time)
      const lotCosts = dto.charcoalInputs.map((inp) => {
        const lot = lotMap.get(inp.lotId)!;
        const costPerKg = new Decimal(lot.costPerKg.toString());
        const cost = costPerKg.mul(inp.kg);
        return { lotId: inp.lotId, kg: inp.kg, costPerKg, cost };
      });

      const totalCost = lotCosts.reduce((s, i) => s.plus(i.cost), new Decimal(0));
      const totalCharcoalKg = lotCosts.reduce((s, i) => s + i.kg, 0);
      const totalBags = dto.bagOutputs.reduce((s, b) => s + b.qty, 0);

      if (totalBags === 0) {
        throw new BadRequestException({ error: 'Total bags must be > 0', code: 'CONSTRAINT_VIOLATION' });
      }

      // Step 4: Compute fill price per bag = totalCost × bagSize / totalOutputKg
      const totalOutputKg = dto.bagOutputs.reduce((s, b) => s + b.size * b.qty, 0);
      const bagOutputs: StoredBagOutput[] = dto.bagOutputs.map((b) => {
        const fillPricePerBag =
          totalOutputKg > 0
            ? (totalCost.toNumber() * b.size) / totalOutputKg
            : totalCost.toNumber() / totalBags;
        return {
          specKey: b.specKey,
          size: b.size,
          charcoal: b.charcoal,
          qty: b.qty,
          fillPricePerBag: Math.round(fillPricePerBag * 10000) / 10000,
        };
      });

      // Step 5: Deduct kgUsed from each lot's kgRemaining
      await Promise.all(lotCosts.map(inp => {
        const lot = lotMap.get(inp.lotId)!;
        const newRemaining = new Decimal(lot.kgRemaining.toString()).minus(inp.kg).toFixed(3);
        return tx.stockLot.update({
          where: { id: inp.lotId },
          data: { kgRemaining: newRemaining },
        });
      }));

      // Step 6: Create FillJob record
      const fillJob = await tx.fillJob.create({
        data: {
          clientId: dto.clientId,
          date: new Date(dto.date),
          workerEntityId: dto.workerEntityId ?? null,
          bagOutputs: bagOutputs as any,
          totalCharcoalKg: totalCharcoalKg.toFixed(3),
          totalBags,
          totalCost: totalCost.toFixed(2),
          notes: dto.notes,
        },
      });

      // Step 7: Create FillJobLot junction rows (one per charcoal input)
      await tx.fillJobLot.createMany({
        data: lotCosts.map(inp => ({
          fillJobId: fillJob.id,
          lotId: inp.lotId,
          kgUsed: inp.kg.toFixed(3),
          costPerKg: inp.costPerKg.toFixed(4),
          cost: inp.cost.toFixed(2),
        })),
      });

      // Step 8: Return fill job id (final fetch happens outside tx)
      return fillJob.id;
    });

    // Fetch with relations outside the transaction — read-only, no contention
    return this.prisma.fillJob.findUnique({
      where: { id: fillJobId },
      include: FILL_JOB_INCLUDE,
    });
  }
}
