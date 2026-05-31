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

const SESSION_INCLUDE = {
  sessionLots: { include: { lot: true } },
  worker: true,
  workerEntity: true,
} as const;

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
    return this.prisma.$transaction(async (tx) => {
      // Step 1: Resolve caller
      const user = await tx.user.upsert({
        where: { clerkId: userId },
        update: {},
        create: { clerkId: userId, email: `${userId}@clerk.local`, name: 'App User', role: 'owner' },
      });

      // Step 2: Fetch all referenced StockLots
      const lotIds = [...new Set(dto.lotInputs.map(i => i.lotId))];
      const lots = await tx.stockLot.findMany({ where: { id: { in: lotIds } } });
      const lotMap = new Map(lots.map(l => [l.id, l]));
      for (const inp of dto.lotInputs) {
        if (!lotMap.has(inp.lotId)) {
          throw new NotFoundException({ error: `Stock lot not found: ${inp.lotId}`, code: 'NOT_FOUND' });
        }
      }

      // Step 3: Validate kgUsed ≤ kgRemaining for each lot
      for (const inp of dto.lotInputs) {
        const l = lotMap.get(inp.lotId)!;
        if (new Decimal(inp.kg).gt(l.kgRemaining.toString())) {
          throw new BadRequestException({
            message: `kgUsed (${inp.kg}) exceeds lot kgRemaining (${l.kgRemaining}) for lot ${inp.lotId}`,
            error: 'kgUsed exceeds lot kgRemaining',
            code: 'CONSTRAINT_VIOLATION',
          });
        }
      }

      // Step 4: Fetch and validate BagTypes
      const bagTypeIds = dto.bagsOutput.map(b => b.bagTypeId);
      const bagTypes = await tx.bagType.findMany({ where: { id: { in: bagTypeIds } } });
      const bagTypeMap = new Map(bagTypes.map(bt => [bt.id, bt]));
      for (const line of dto.bagsOutput) {
        if (!bagTypeMap.has(line.bagTypeId)) {
          throw new BadRequestException({ message: `Bag type not found: ${line.bagTypeId}`, code: 'BAG_TYPE_NOT_FOUND' });
        }
      }

      // Step 5: Compute kgOutputTotal
      let kgOutputTotal = new Decimal(0);
      for (const line of dto.bagsOutput) {
        const bt = bagTypeMap.get(line.bagTypeId)!;
        kgOutputTotal = kgOutputTotal.plus(new Decimal(bt.nominalKg.toString()).mul(line.qty));
      }

      // Step 6: Total charcoal consumed = sum of all lot inputs
      const totalKgConsumed = dto.lotInputs.reduce(
        (s, i) => s.plus(new Decimal(i.kg)),
        new Decimal(0),
      );

      // Step 7: varianceKg = totalKgConsumed − kgOutputTotal (waste/loss)
      const varianceKg = totalKgConsumed.minus(kgOutputTotal);

      // Step 8: Negative variance requires a note
      if (varianceKg.lt(0) && !dto.varianceNote) {
        throw new BadRequestException({
          message: 'Negative variance requires varianceNote',
          error: 'Negative variance requires varianceNote',
          code: 'CONSTRAINT_VIOLATION',
        });
      }

      // Step 9: sessionEarnings = Σ(workerRate × qty)
      let sessionEarnings = new Decimal(0);
      for (const line of dto.bagsOutput) {
        const bt = bagTypeMap.get(line.bagTypeId)!;
        sessionEarnings = sessionEarnings.plus(new Decimal(bt.workerRate.toString()).mul(line.qty));
      }

      // Step 10: Decrement kgRemaining for every lot (safe — validated in step 3)
      for (const inp of dto.lotInputs) {
        const l = lotMap.get(inp.lotId)!;
        await tx.stockLot.update({
          where: { id: inp.lotId },
          data: { kgRemaining: new Decimal(l.kgRemaining.toString()).minus(inp.kg).toFixed(3) },
        });
      }

      // Step 11: Create PackingSession
      const session = await tx.packingSession.create({
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

      // Step 12: Create PackingSessionLot junction rows (one per lot input)
      for (const inp of dto.lotInputs) {
        await tx.packingSessionLot.create({
          data: { sessionId: session.id, lotId: inp.lotId, kgUsed: inp.kg },
        });
      }

      // Step 13: Create PackedStock (one per bag line; lotId = first lot for backward compat)
      const primaryLotId = dto.lotInputs[0].lotId;
      for (const line of dto.bagsOutput) {
        await tx.packedStock.create({
          data: { lotId: primaryLotId, bagTypeId: line.bagTypeId, quantity: line.qty, sessionId: session.id },
        });
      }

      // Step 14: Update Worker entity totals
      if (dto.workerEntityId) {
        const workerEntity = await tx.worker.findUnique({ where: { id: dto.workerEntityId } });
        if (workerEntity) {
          const newTotalEarned = new Decimal(workerEntity.totalEarned.toString()).plus(sessionEarnings).toFixed(2);
          const bagsPacked = (workerEntity.totalBagsPacked as unknown as Array<{ bagTypeId: string; count: number }>) ?? [];
          const updatedBags = [...bagsPacked];
          for (const line of dto.bagsOutput) {
            const idx = updatedBags.findIndex(b => b.bagTypeId === line.bagTypeId);
            if (idx >= 0) updatedBags[idx] = { ...updatedBags[idx], count: updatedBags[idx].count + line.qty };
            else updatedBags.push({ bagTypeId: line.bagTypeId, count: line.qty });
          }
          await tx.worker.update({
            where: { id: dto.workerEntityId },
            data: { totalEarned: newTotalEarned, totalBagsPacked: updatedBags as unknown as Prisma.InputJsonValue },
          });
        }
      }

      // Step 15: Return session with junction lots included
      return tx.packingSession.findUnique({
        where: { id: session.id },
        include: { ...SESSION_INCLUDE, packedStocks: { include: { bagType: true } } },
      });
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

      // Restore old lot kgRemaining from junction table
      const oldLotIds = [...new Set(existing.sessionLots.map(sl => sl.lotId))];
      const oldLots = await tx.stockLot.findMany({ where: { id: { in: oldLotIds } } });
      const oldLotMap = new Map(oldLots.map(l => [l.id, l]));
      for (const sl of existing.sessionLots) {
        const l = oldLotMap.get(sl.lotId);
        if (l) {
          await tx.stockLot.update({
            where: { id: sl.lotId },
            data: { kgRemaining: new Decimal(l.kgRemaining.toString()).plus(sl.kgUsed.toString()).toFixed(3) },
          });
        }
      }

      // Resolve new lot inputs (fall back to old if not provided)
      const newLotInputs: Array<{ lotId: string; kg: string }> =
        dto.lotInputs && dto.lotInputs.length > 0
          ? dto.lotInputs
          : existing.sessionLots.map(sl => ({ lotId: sl.lotId, kg: sl.kgUsed.toString() }));

      // Fetch and validate new lots (reads post-restore kgRemaining within transaction)
      const newLotIds = [...new Set(newLotInputs.map(i => i.lotId))];
      const newLots = await tx.stockLot.findMany({ where: { id: { in: newLotIds } } });
      const newLotMap = new Map(newLots.map(l => [l.id, l]));
      for (const inp of newLotInputs) {
        if (!newLotMap.has(inp.lotId)) throw new NotFoundException({ error: `Stock lot not found: ${inp.lotId}`, code: 'NOT_FOUND' });
        const l = newLotMap.get(inp.lotId)!;
        if (new Decimal(inp.kg).gt(l.kgRemaining.toString())) {
          throw new BadRequestException({
            message: `kgUsed (${inp.kg}) exceeds lot kgRemaining (${l.kgRemaining}) for lot ${inp.lotId}`,
            error: 'kgUsed exceeds lot kgRemaining',
            code: 'CONSTRAINT_VIOLATION',
          });
        }
      }

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

      // Reverse old worker earnings
      if (existing.workerEntityId) {
        const oldWorker = await tx.worker.findUnique({ where: { id: existing.workerEntityId } });
        if (oldWorker) {
          const newTotalEarned = new Decimal(oldWorker.totalEarned.toString())
            .minus(existing.sessionEarnings.toString())
            .toFixed(2);
          const bagsPacked = (oldWorker.totalBagsPacked as unknown as Array<{ bagTypeId: string; count: number }>) ?? [];
          const updatedBags = [...bagsPacked];
          for (const line of existing.bagsOutput as Array<{ bagTypeId: string; qty: number }>) {
            const idx = updatedBags.findIndex(b => b.bagTypeId === line.bagTypeId);
            if (idx >= 0) updatedBags[idx] = { ...updatedBags[idx], count: Math.max(0, updatedBags[idx].count - line.qty) };
          }
          await tx.worker.update({
            where: { id: existing.workerEntityId },
            data: { totalEarned: newTotalEarned, totalBagsPacked: updatedBags as unknown as Prisma.InputJsonValue },
          });
        }
      }

      // Apply new lot deductions
      for (const inp of newLotInputs) {
        const l = newLotMap.get(inp.lotId)!;
        await tx.stockLot.update({
          where: { id: inp.lotId },
          data: { kgRemaining: new Decimal(l.kgRemaining.toString()).minus(inp.kg).toFixed(3) },
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

      // Replace junction rows
      await tx.packingSessionLot.deleteMany({ where: { sessionId: id } });
      for (const inp of newLotInputs) {
        await tx.packingSessionLot.create({ data: { sessionId: id, lotId: inp.lotId, kgUsed: inp.kg } });
      }

      // Replace PackedStock records
      await tx.packedStock.deleteMany({ where: { sessionId: id } });
      const primaryLotId = newLotInputs[0].lotId;
      for (const line of newBagsOutput) {
        await tx.packedStock.create({
          data: { lotId: primaryLotId, bagTypeId: line.bagTypeId, quantity: line.qty, sessionId: id },
        });
      }

      // Apply new worker earnings
      if (newWorkerEntityId) {
        const newWorker = await tx.worker.findUnique({ where: { id: newWorkerEntityId } });
        if (newWorker) {
          const newTotalEarned = new Decimal(newWorker.totalEarned.toString()).plus(sessionEarnings).toFixed(2);
          const bagsPacked = (newWorker.totalBagsPacked as unknown as Array<{ bagTypeId: string; count: number }>) ?? [];
          const updatedBags = [...bagsPacked];
          for (const line of newBagsOutput) {
            const idx = updatedBags.findIndex(b => b.bagTypeId === line.bagTypeId);
            if (idx >= 0) updatedBags[idx] = { ...updatedBags[idx], count: updatedBags[idx].count + line.qty };
            else updatedBags.push({ bagTypeId: line.bagTypeId, count: line.qty });
          }
          await tx.worker.update({
            where: { id: newWorkerEntityId },
            data: { totalEarned: newTotalEarned, totalBagsPacked: updatedBags as unknown as Prisma.InputJsonValue },
          });
        }
      }

      return tx.packingSession.findUnique({
        where: { id },
        include: { ...SESSION_INCLUDE, packedStocks: { include: { bagType: true } } },
      });
    });
  }
}
