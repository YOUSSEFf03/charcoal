import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePackingSessionDto } from './dto/create-packing-session.dto';
import { UpdatePackingSessionDto } from './dto/update-packing-session.dto';
import { ClerkUser } from '../auth/clerk.strategy';
import { Prisma } from '@prisma/client';
import { consumeLots } from '../common/inventory/consume-lots';

const SESSION_INCLUDE = {
  sessionLots: { include: { lot: true } },
  worker: true,
  workerEntity: true,
} as const;

/**
 * Distributes bag output across multiple source lots proportionally to kg consumed.
 * Uses the largest-remainder method so every bag type's total is preserved exactly.
 * Returns one row per (lot × bagType) pair where qty > 0 — safe to create as PackedStock.
 *
 * Example: 10 bags, lot A 60 kg, lot B 40 kg → lot A gets 6 bags, lot B gets 4 bags.
 */
function splitBagsAcrossLots(
  lotInputs: Array<{ lotId: string; kg: string }>,
  bagsOutput: Array<{ bagTypeId: string; qty: number }>,
  totalKg: Decimal,
): Array<{ lotId: string; bagTypeId: string; qty: number }> {
  const result: Array<{ lotId: string; bagTypeId: string; qty: number }> = [];

  for (const line of bagsOutput) {
    if (lotInputs.length === 1) {
      result.push({ lotId: lotInputs[0].lotId, bagTypeId: line.bagTypeId, qty: line.qty });
      continue;
    }

    // Exact proportional share per lot computed in Decimal to avoid intermediate float error
    const shares = lotInputs.map(inp => {
      const exact = new Decimal(line.qty).times(new Decimal(inp.kg)).div(totalKg);
      const floor = Math.floor(exact.toNumber());
      return { lotId: inp.lotId, floor, frac: exact.minus(floor).toNumber() };
    });

    // Assign remaining bags (after floor) to lots with the largest fractional parts
    let remainder = line.qty - shares.reduce((s, x) => s + x.floor, 0);
    shares.sort((a, b) => b.frac - a.frac);
    for (const s of shares) {
      if (remainder <= 0) break;
      s.floor++;
      remainder--;
    }

    for (const s of shares) {
      if (s.floor > 0) result.push({ lotId: s.lotId, bagTypeId: line.bagTypeId, qty: s.floor });
    }
  }

  return result;
}

@Injectable()
export class PackingSessionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    page: number,
    limit: number,
    workerIdParam?: string,
    lotId?: string,
    dateFrom?: string,
    dateTo?: string,
    currentUser?: ClerkUser,
    workerEntityId?: string,
  ) {
    const skip = (page - 1) * limit;

    let resolvedWorkerId: string | undefined;
    if (currentUser?.role === 'worker') {
      const user = await this.prisma.user.findUnique({ where: { clerkId: currentUser.userId } });
      if (!user) throw new NotFoundException({ error: 'User not found', code: 'NOT_FOUND' });
      resolvedWorkerId = user.id;
    } else {
      resolvedWorkerId = workerIdParam;
    }

    const where: Prisma.PackingSessionWhereInput = {
      ...(resolvedWorkerId ? { workerId: resolvedWorkerId } : {}),
      ...(workerEntityId ? { workerEntityId } : {}),
      // Filter by lot via the junction table
      ...(lotId ? { sessionLots: { some: { lotId } } } : {}),
      ...(dateFrom || dateTo
        ? { date: { ...(dateFrom ? { gte: new Date(dateFrom) } : {}), ...(dateTo ? { lte: new Date(dateTo) } : {}) } }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.packingSession.findMany({
        where,
        skip,
        take: limit,
        orderBy: { startedAt: 'desc' },
        include: SESSION_INCLUDE,
      }),
      this.prisma.packingSession.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: string, currentUser: ClerkUser) {
    const session = await this.prisma.packingSession.findUnique({
      where: { id },
      include: {
        ...SESSION_INCLUDE,
        packedStocks: { include: { bagType: true } },
      },
    });

    if (!session) throw new NotFoundException({ error: 'Packing session not found', code: 'NOT_FOUND' });

    if (currentUser.role === 'worker') {
      const user = await this.prisma.user.findUnique({ where: { clerkId: currentUser.userId } });
      if (!user || session.workerId !== user.id) {
        throw new ForbiddenException({ error: 'Access denied to this packing session', code: 'FORBIDDEN' });
      }
    }

    return session;
  }

  /**
   * Create a packing session in a single atomic transaction.
   *
   * Steps:
   *   1. Resolve caller User from Clerk JWT
   *   2. Fetch all referenced StockLots (404 if any missing)
   *   3. CONSTRAINT: kgUsed ≤ lot.kgRemaining for every lot input
   *   4. Fetch and validate all BagTypes
   *   5. Compute kgOutputTotal = Σ(nominalKg × qty)
   *   6. Compute totalKgConsumed = Σ(lotInput.kg)
   *   7. Compute varianceKg = totalKgConsumed − kgOutputTotal
   *   8. CONSTRAINT: varianceKg < 0 requires varianceNote
   *   9. Compute sessionEarnings = Σ(workerRate × qty)
   *  10. Decrement kgRemaining for every lot used
   *  11. Create PackingSession record
   *  12. Create PackingSessionLot records (the junction rows)
   *  13. Create PackedStock records (one per bag line)
   *  14. Update Worker entity earnings if workerEntityId provided
   *  15. Return created session with session lots
   */
  async createPackingSession(dto: CreatePackingSessionDto, userId: string) {
    // Step 1: Resolve caller — must already be synced via Clerk webhook; never auto-create.
    const user = await this.prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) throw new ForbiddenException({ error: 'User not synced', code: 'NO_USER' });

    // Step 4 (pre-tx): Fetch and validate BagTypes
    const bagTypeIds = dto.bagsOutput.map(b => b.bagTypeId);
    const bagTypes = await this.prisma.bagType.findMany({ where: { id: { in: bagTypeIds } } });
    const bagTypeMap = new Map(bagTypes.map(bt => [bt.id, bt]));
    for (const line of dto.bagsOutput) {
      if (!bagTypeMap.has(line.bagTypeId)) {
        throw new BadRequestException({ message: `Bag type not found: ${line.bagTypeId}`, code: 'BAG_TYPE_NOT_FOUND' });
      }
    }

    // Step 5 (pre-tx): Compute kgOutputTotal
    let kgOutputTotal = new Decimal(0);
    for (const line of dto.bagsOutput) {
      const bt = bagTypeMap.get(line.bagTypeId)!;
      kgOutputTotal = kgOutputTotal.plus(new Decimal(bt.nominalKg.toString()).mul(line.qty));
    }

    // Step 6 (pre-tx): Total charcoal consumed = sum of all lot inputs
    const totalKgConsumed = dto.lotInputs.reduce(
      (s, i) => s.plus(new Decimal(i.kg)),
      new Decimal(0),
    );

    // Step 7 (pre-tx): varianceKg = totalKgConsumed − kgOutputTotal (waste/loss)
    const varianceKg = totalKgConsumed.minus(kgOutputTotal);

    // Step 8 (pre-tx): Negative variance requires a note
    if (varianceKg.lt(0) && !dto.varianceNote) {
      throw new BadRequestException({
        message: 'Negative variance requires varianceNote',
        error: 'Negative variance requires varianceNote',
        code: 'CONSTRAINT_VIOLATION',
      });
    }

    // Step 9 (pre-tx): sessionEarnings = Σ(workerRate × qty)
    let sessionEarnings = new Decimal(0);
    for (const line of dto.bagsOutput) {
      const bt = bagTypeMap.get(line.bagTypeId)!;
      sessionEarnings = sessionEarnings.plus(new Decimal(bt.workerRate.toString()).mul(line.qty));
    }

    const sessionId = await this.prisma.$transaction(async (tx) => {
      // Steps 2, 3, 10: aggregate by lotId, validate kgUsed ≤ kgRemaining, and deduct
      // via atomic { decrement } — all through the shared consume-lots primitive.
      // Duplicate lotIds in dto.lotInputs are summed and deducted once (no lost update).
      const consumed = await consumeLots(tx, dto.lotInputs);

      // Aggregated per-lot inputs — the single source of truth for junction + split rows.
      const aggregatedLotInputs = consumed.map(c => ({ lotId: c.lotId, kg: c.kg.toFixed(3) }));

      // Conservation invariant: Σinput = Σoutput + variance (waste/loss). Asserted inside
      // the transaction so any drift rolls the whole session back before commit.
      const consumedTotal = consumed.reduce((s, c) => s.plus(c.kg), new Decimal(0));
      if (!consumedTotal.minus(kgOutputTotal).minus(varianceKg).abs().lte('0.001')) {
        throw new BadRequestException({
          message: `Conservation check failed: Σinput (${consumedTotal.toFixed(3)}) ≠ Σoutput (${kgOutputTotal.toFixed(3)}) + variance (${varianceKg.toFixed(3)})`,
          error: 'Conservation invariant violated',
          code: 'CONSTRAINT_VIOLATION',
        });
      }

      // Step 11: Create PackingSession
      const created = await tx.packingSession.create({
        data: {
          workerId: user.id,
          mode: 'stock',
          kgConsumed: totalKgConsumed.toFixed(3),
          bagsOutput: dto.bagsOutput as unknown as Prisma.InputJsonValue,
          kgOutputTotal: kgOutputTotal.toFixed(3),
          varianceKg: varianceKg.toFixed(3),
          varianceNote: dto.varianceNote,
          sessionEarnings: sessionEarnings.toFixed(2),
          date: dto.date ? new Date(dto.date) : new Date(),
          completedAt: new Date(),
          notes: dto.notes,
          ...(dto.workerEntityId ? { workerEntityId: dto.workerEntityId } : {}),
        },
      });

      // Step 12: Create PackingSessionLot junction rows (one per DISTINCT lot — aggregated)
      await tx.packingSessionLot.createMany({
        data: aggregatedLotInputs.map(inp => ({ sessionId: created.id, lotId: inp.lotId, kgUsed: inp.kg })),
      });

      // Step 13: Create PackedStock — one row per (lot × bagType), split proportionally so
      // each row carries a single defensible costPerKg for COGS tracing.
      const splitRows = splitBagsAcrossLots(aggregatedLotInputs, dto.bagsOutput, totalKgConsumed);
      await tx.packedStock.createMany({
        data: splitRows.map(row => ({ lotId: row.lotId, bagTypeId: row.bagTypeId, quantity: row.qty, sessionId: created.id })),
      });

      // Step 14: (removed) Worker.totalEarned / totalBagsPacked are deprecated cache columns.
      // Totals are computed on read from PackingSession.sessionEarnings — see workers.service.ts.

      return created.id;
    });

    // Step 15: Return session with junction lots included (outside tx — read-only, no contention)
    return this.prisma.packingSession.findUnique({
      where: { id: sessionId },
      include: { ...SESSION_INCLUDE, packedStocks: { include: { bagType: true } } },
    });
  }

  /**
   * Update an existing packing session atomically.
   * Reverses old lot deductions and worker earnings, applies the new values.
   *
   * Blocked if packed stock from this session has been used in stock exits or adjustments.
   */
  async updatePackingSession(id: string, dto: UpdatePackingSessionDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      // Fetch existing session with junction lots and packed stocks
      const existing = await tx.packingSession.findUnique({
        where: { id },
        include: { sessionLots: true, packedStocks: true },
      });
      if (!existing) throw new NotFoundException({ error: 'Packing session not found', code: 'NOT_FOUND' });

      // Block if packed stock has downstream records
      const packedStockIds = existing.packedStocks.map(ps => ps.id);
      if (packedStockIds.length > 0) {
        const exitCount = await tx.stockExit.count({ where: { packedStockId: { in: packedStockIds } } });
        const adjCount  = await tx.stockAdjustment.count({ where: { packedStockId: { in: packedStockIds } } });
        if (exitCount > 0 || adjCount > 0) {
          throw new BadRequestException({
            message: 'Cannot update: packed stock from this session has stock exits or adjustments referencing it',
            error: 'EDIT_BLOCKED',
            code: 'EDIT_BLOCKED',
          });
        }
      }

      // Restore old lot kgRemaining from junction table via atomic { increment }.
      // Junction rows are already one-per-distinct-lot, so each increment is independent.
      await Promise.all(existing.sessionLots.map(sl =>
        tx.stockLot.update({
          where: { id: sl.lotId },
          data: { kgRemaining: { increment: new Decimal(sl.kgUsed.toString()).toFixed(3) } },
        }),
      ));

      // Resolve new lot inputs (fall back to old if not provided)
      const newLotInputs: Array<{ lotId: string; kg: string }> =
        dto.lotInputs && dto.lotInputs.length > 0
          ? dto.lotInputs
          : existing.sessionLots.map(sl => ({ lotId: sl.lotId, kg: sl.kgUsed.toString() }));

      // Resolve new bags output
      const newBagsOutput: Array<{ bagTypeId: string; qty: number }> =
        dto.bagsOutput && dto.bagsOutput.length > 0
          ? dto.bagsOutput
          : (existing.bagsOutput as Array<{ bagTypeId: string; qty: number }>);

      const bagTypeIds = newBagsOutput.map(b => b.bagTypeId);
      const bagTypes = await tx.bagType.findMany({ where: { id: { in: bagTypeIds } } });
      const bagTypeMap = new Map(bagTypes.map(bt => [bt.id, bt]));
      for (const line of newBagsOutput) {
        if (!bagTypeMap.has(line.bagTypeId)) throw new BadRequestException({ message: `Bag type not found: ${line.bagTypeId}`, code: 'BAG_TYPE_NOT_FOUND' });
      }

      // Compute derived fields
      let kgOutputTotal = new Decimal(0);
      for (const line of newBagsOutput) {
        const bt = bagTypeMap.get(line.bagTypeId)!;
        kgOutputTotal = kgOutputTotal.plus(new Decimal(bt.nominalKg.toString()).mul(line.qty));
      }
      const totalKgConsumed = newLotInputs.reduce((s, i) => s.plus(new Decimal(i.kg)), new Decimal(0));
      const varianceKg = totalKgConsumed.minus(kgOutputTotal);

      const newVarianceNote = dto.varianceNote !== undefined ? dto.varianceNote : existing.varianceNote;
      if (varianceKg.lt(0) && !newVarianceNote) {
        throw new BadRequestException({ message: 'Negative variance requires varianceNote', code: 'CONSTRAINT_VIOLATION' });
      }

      let sessionEarnings = new Decimal(0);
      for (const line of newBagsOutput) {
        const bt = bagTypeMap.get(line.bagTypeId)!;
        sessionEarnings = sessionEarnings.plus(new Decimal(bt.workerRate.toString()).mul(line.qty));
      }

      // Aggregate by lotId, validate (reads post-restore kgRemaining within the tx), and
      // deduct via atomic { decrement } through the shared consume-lots primitive.
      const consumed = await consumeLots(tx, newLotInputs);
      const aggregatedLotInputs = consumed.map(c => ({ lotId: c.lotId, kg: c.kg.toFixed(3) }));

      // Conservation invariant: Σinput = Σoutput + variance, asserted before commit.
      const consumedTotal = consumed.reduce((s, c) => s.plus(c.kg), new Decimal(0));
      if (!consumedTotal.minus(kgOutputTotal).minus(varianceKg).abs().lte('0.001')) {
        throw new BadRequestException({
          message: `Conservation check failed: Σinput (${consumedTotal.toFixed(3)}) ≠ Σoutput (${kgOutputTotal.toFixed(3)}) + variance (${varianceKg.toFixed(3)})`,
          error: 'Conservation invariant violated',
          code: 'CONSTRAINT_VIOLATION',
        });
      }

      const newWorkerEntityId =
        dto.workerEntityId !== undefined ? (dto.workerEntityId || null) : existing.workerEntityId;

      // Update session record
      await tx.packingSession.update({
        where: { id },
        data: {
          kgConsumed: totalKgConsumed.toFixed(3),
          bagsOutput: newBagsOutput as unknown as Prisma.InputJsonValue,
          kgOutputTotal: kgOutputTotal.toFixed(3),
          varianceKg: varianceKg.toFixed(3),
          varianceNote: newVarianceNote,
          sessionEarnings: sessionEarnings.toFixed(2),
          notes: dto.notes !== undefined ? (dto.notes || null) : existing.notes,
          workerEntityId: newWorkerEntityId,
        },
      });

      // Replace junction rows (one per DISTINCT lot — aggregated)
      await tx.packingSessionLot.deleteMany({ where: { sessionId: id } });
      await tx.packingSessionLot.createMany({
        data: aggregatedLotInputs.map(inp => ({ sessionId: id, lotId: inp.lotId, kgUsed: inp.kg })),
      });

      // Replace PackedStock records — same proportional split as create
      await tx.packedStock.deleteMany({ where: { sessionId: id } });
      const updateSplitRows = splitBagsAcrossLots(aggregatedLotInputs, newBagsOutput, totalKgConsumed);
      await tx.packedStock.createMany({
        data: updateSplitRows.map(row => ({ lotId: row.lotId, bagTypeId: row.bagTypeId, quantity: row.qty, sessionId: id })),
      });

      // Worker.totalEarned / totalBagsPacked not updated here — computed on read.
    });

    // Return session outside transaction — read-only, no contention
    return this.prisma.packingSession.findUnique({
      where: { id },
      include: { ...SESSION_INCLUDE, packedStocks: { include: { bagType: true } } },
    });
  }
}
