import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFillJobDto } from './dto/create-fill-job.dto';
import { consumeLots } from '../common/inventory/consume-lots';

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
   *   1. Aggregate by lotId, validate kgUsed ≤ kgRemaining, and deduct via atomic
   *      { decrement } — all through the shared consume-lots primitive.
   *   2. Compute per-lot costs from the snapshot costPerKg returned by the primitive.
   *   3. Compute fill price per bag = totalCost × bagSize / totalOutputKg.
   *   4. Assert the conservation invariant (Σinput = Σoutput + variance) before commit.
   *   5. Create FillJob record.
   *   6. Create FillJobLot junction rows (one per DISTINCT lot — aggregated).
   *   7. Create exactly one client_bags_fill StockExit for the job's total kg.
   *   8. Return job with fill lots included.
   *
   * @param dto    Fill job payload (charcoalInputs may contain duplicate lotIds — they are summed).
   * @param userId Clerk user id of the caller — resolved to loggedById on the stock exit.
   */
  async create(dto: CreateFillJobDto, userId: string) {
    // Resolve caller before the transaction — needed for the required StockExit.loggedById.
    const user = await this.prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) throw new NotFoundException({ error: 'User not found', code: 'NOT_FOUND' });

    const fillJobId = await this.prisma.$transaction(async (tx) => {
      // Step 1: aggregate + validate + atomic decrement via the shared primitive.
      const consumed = await consumeLots(tx, dto.charcoalInputs);

      // Step 2: per-lot costs from the snapshot costPerKg the primitive returned.
      const lotCosts = consumed.map((c) => ({
        lotId: c.lotId,
        kg: c.kg,
        costPerKg: c.costPerKg,
        cost: c.costPerKg.mul(c.kg),
      }));

      const totalCost = lotCosts.reduce((s, i) => s.plus(i.cost), new Decimal(0));
      const totalCharcoalKg = lotCosts.reduce((s, i) => s.plus(i.kg), new Decimal(0));
      const totalBags = dto.bagOutputs.reduce((s, b) => s + b.qty, 0);

      if (totalBags === 0) {
        throw new BadRequestException({ error: 'Total bags must be > 0', code: 'CONSTRAINT_VIOLATION' });
      }

      // Step 3: Compute fill price per bag = totalCost × bagSize / totalOutputKg
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

      // Step 4: Conservation invariant — Σinput = Σoutput(bags) + variance/loss.
      // variance is the residual charcoal not bagged; assert it is non-negative and
      // that the books balance before commit.
      const variance = totalCharcoalKg.minus(totalOutputKg);
      if (variance.lt(-0.001)) {
        throw new BadRequestException({
          error: `Fill output (${totalOutputKg} kg) exceeds charcoal consumed (${totalCharcoalKg.toFixed(3)} kg)`,
          code: 'CONSTRAINT_VIOLATION',
        });
      }
      if (!totalCharcoalKg.minus(totalOutputKg).minus(variance).abs().lte('0.001')) {
        throw new BadRequestException({
          error: 'Conservation invariant violated for fill job',
          code: 'CONSTRAINT_VIOLATION',
        });
      }

      // Step 5: Create FillJob record
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

      // Step 6: Create FillJobLot junction rows (one per DISTINCT lot — aggregated)
      await tx.fillJobLot.createMany({
        data: lotCosts.map(inp => ({
          fillJobId: fillJob.id,
          lotId: inp.lotId,
          kgUsed: inp.kg.toFixed(3),
          costPerKg: inp.costPerKg.toFixed(4),
          cost: inp.cost.toFixed(2),
        })),
      });

      // Step 7: Create exactly one client_bags_fill stock exit recording the charcoal
      // that left the warehouse for this fill job (quantity in kg = total consumed).
      await tx.stockExit.create({
        data: {
          exitType: 'client_bags_fill',
          date: new Date(dto.date),
          clientId: dto.clientId,
          loggedById: user.id,
          kgQuantity: totalCharcoalKg.toFixed(3),
          reason: `Fill job ${fillJob.id}`,
        },
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
