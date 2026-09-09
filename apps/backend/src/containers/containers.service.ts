import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { buildDateFilter } from '../reports/reports.service';
import { CreateContainerDto } from './dto/create-container.dto';
import { UpdateContainerDto } from './dto/update-container.dto';
import { CreateProductLineDto } from './dto/create-product-line.dto';
import { UpdateProductLineDto } from './dto/update-product-line.dto';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { UpsertDiscountDto } from './dto/upsert-discount.dto';
import { ContainerNotificationService } from '../notifications/container-notification.service';

@Injectable()
export class ContainersService {
  private readonly logger = new Logger(ContainersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: ContainerNotificationService,
  ) {}

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Recalculate and persist `costPerKg` on every StockLot tied to this container.
   *
   * This is the **single source of truth** for container cost calculation (@constraint 9).
   * It MUST be called inside an open `prisma.$transaction()` — never opens its own transaction.
   * It is safe to call when no StockLots exist yet (container not arrived); it returns early.
   *
   * ### Formula (all arithmetic via decimal.js — no native JS floats)
   * ```
   * tonnage          = paidBags × kgPerBag / 1000         (per product line)
   * totalTonnage     = Σ tonnage                           (across all lines)
   * expenseShare     = totalExpenses × (tonnage / totalTonnage)
   * discountShare    = totalDiscount × (tonnage / totalTonnage)
   * allInCostPerTon  = pricePerTon + (expenseShare / tonnage) − (discountShare / tonnage)
   * allInCostPerKg   = allInCostPerTon / 1000
   * ```
   *
   * ### StockLot matching (BUG-1 / P1)
   * Lots are matched to product lines by the persisted `StockLot.productLineId` FK — the
   * real key — never by `createdAt` array index. This guarantees a lot's cost always
   * derives from its OWN product line, even when:
   *   - lines or lots are created out of `createdAt` order,
   *   - a line is added to an arrived container after the fact,
   *   - two lines share the same charcoalType/grade/supplier.
   * Lots with a null `productLineId` (legacy rows the backfill could not bind) are skipped
   * defensively rather than mis-assigned by index.
   *
   * @constraint 8  One StockLot per ContainerProductLine — never merged across lines.
   * @constraint 9  Called after every expense, discount, and product-line write.
   *
   * @param containerId - UUID of the container whose lots should be recalculated.
   * @param tx          - Active Prisma transaction client. Must be provided by the caller.
   * @returns           Promise<void> — updates are applied in place via tx.stockLot.update.
   */
  async recalculateContainerCosts(
    containerId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const container = await tx.container.findUnique({
      where: { id: containerId },
      include: {
        productLines: { orderBy: { createdAt: 'asc' } },
        expenses: true,
        discount: true,
      },
    });

    if (!container || container.productLines.length === 0) return;

    // Cost-protection backstop: a finalized container's StockLot.costPerKg
    // must never move again, even if some future call site forgets its own
    // CONTAINER_FINALIZED guard. Every public mutation that reaches this
    // function (expense/discount/product-line writes) already checks
    // finalizedAt itself and throws a proper business error before ever
    // calling this — this is a silent no-op defense-in-depth, not the
    // primary guard, so it deliberately does not throw.
    if (container.finalizedAt) return;

    const totalExpenses = container.expenses.reduce(
      (sum, e) => sum.plus(new Decimal(e.amount.toString())),
      new Decimal(0),
    );

    const totalDiscount = container.discount
      ? new Decimal(container.discount.amount.toString())
      : new Decimal(0);

    const tonnages = container.productLines.map((line) =>
      new Decimal(line.paidBags)
        .mul(new Decimal(line.kgPerBag.toString()))
        .div(1000),
    );

    const totalTonnage = tonnages.reduce(
      (sum, t) => sum.plus(t),
      new Decimal(0),
    );

    // Guard against division by zero
    if (totalTonnage.isZero()) return;

    // Fetch this container's stock lots.
    const lots = await tx.stockLot.findMany({
      where: { containerId, source: 'container' },
    });

    // Container not yet arrived — nothing to update
    if (lots.length === 0) return;

    // BUG-1 (P1): index lots by their real productLineId FK so each line updates
    // its OWN lot(s), independent of createdAt ordering.
    const lotsByLineId = new Map<string, typeof lots>();
    for (const lot of lots) {
      if (!lot.productLineId) continue; // legacy null FK — skip rather than mis-map by index
      const bucket = lotsByLineId.get(lot.productLineId);
      if (bucket) bucket.push(lot);
      else lotsByLineId.set(lot.productLineId, [lot]);
    }

    const updates: Promise<unknown>[] = [];
    container.productLines.forEach((line, i) => {
      const lineLots = lotsByLineId.get(line.id);
      if (!lineLots || lineLots.length === 0) return;
      const tonnage = tonnages[i];
      const expenseShare  = totalExpenses.mul(tonnage).div(totalTonnage);
      const discountShare = totalDiscount.mul(tonnage).div(totalTonnage);
      const allInCostPerTon = new Decimal(line.pricePerTon.toString())
        .plus(expenseShare.div(tonnage))
        .minus(discountShare.div(tonnage));
      const allInCostPerKg = allInCostPerTon.div(1000);
      for (const lot of lineLots) {
        updates.push(
          tx.stockLot.update({
            where: { id: lot.id },
            data: { costPerKg: allInCostPerKg.toFixed(4) },
          }),
        );
      }
    });

    await Promise.all(updates);
  }

  /**
   * Throws CONTAINER_FINALIZED if this container's financial/identity record
   * has been locked (Container.finalizedAt is set). Called by every mutation
   * the approved finalization design requires to stop working post-
   * finalization: expense/discount writes, and identity/supplier/carrier/
   * status edits in update(). Product-line writes and container deletion
   * need no separate call to this — they already reject whenever
   * `status === 'arrived'`, and finalization is only ever reachable from
   * that status, so they're transitively covered by the existing guard.
   */
  private assertNotFinalized(container: { finalizedAt: Date | null }): void {
    if (container.finalizedAt) {
      throw new BadRequestException({
        error: 'This container has been finalized. Its financial information can no longer be changed.',
        code: 'CONTAINER_FINALIZED',
      });
    }
  }

  /**
   * Strip sensitive cost fields from a container response when role === 'sales_rep'.
   * CONSTRAINT 12.
   */
  private stripCostFields(data: any, role?: string): any {
    if (role !== 'sales_rep') return data;

    const COST_FIELDS = [
      'costPerKg',
      'allInCostPerKg',
      'allInCostPerTon',
      'pricePerTon',
      'expenseShare',
      'discountShare',
    ];

    const strip = (obj: any): any => {
      if (!obj || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map(strip);

      const result = { ...obj };

      for (const field of COST_FIELDS) {
        delete result[field];
      }

      if (result.totals && typeof result.totals === 'object') {
        const t = { ...result.totals };
        delete t.averageCostPerKg;
        delete t.totalExpenses;
        delete t.totalDiscount;
        result.totals = t;
      }

      if (Array.isArray(result.productLines)) {
        result.productLines = result.productLines.map(strip);
      }

      if (Array.isArray(result.stockLots)) {
        result.stockLots = result.stockLots.map((s: any) => {
          const sl = { ...s };
          delete sl.costPerKg;
          return sl;
        });
      }

      return result;
    };

    return strip(data);
  }

  /**
   * Compute aggregate totals for a container (expenses, discount, tonnage,
   * average cost per kg).  Returned as plain strings to avoid Prisma Decimal
   * objects in the response.
   */
  private computeTotals(container: {
    expenses: Array<{ amount: { toString(): string } }>;
    discount: { amount: { toString(): string } } | null;
    productLines: Array<{
      paidBags: number;
      kgPerBag: { toString(): string };
    }>;
    // costPerKg is optional here: findOne()'s full StockLot relation has it,
    // but findAll()'s select-scoped stockLots (kgReceived/kgRemaining only —
    // added for the Finalize summary / History "Remaining stock" column,
    // never over-fetching cost into the list) does not. Lots missing it are
    // excluded from the average below rather than crashing on `undefined.toString()`.
    stockLots?: Array<{ costPerKg?: { toString(): string } | null }>;
  }) {
    const totalExpenses = container.expenses.reduce(
      (sum, e) => sum.plus(new Decimal(e.amount.toString())),
      new Decimal(0),
    );

    const totalDiscount = container.discount
      ? new Decimal(container.discount.amount.toString())
      : new Decimal(0);

    const tonnages = container.productLines.map((line) =>
      new Decimal(line.paidBags)
        .mul(new Decimal(line.kgPerBag.toString()))
        .div(1000),
    );

    const totalTonnage = tonnages.reduce(
      (sum, t) => sum.plus(t),
      new Decimal(0),
    );

    let averageCostPerKg: string | null = null;
    const lotsWithCost = (container.stockLots ?? []).filter(
      (lot): lot is { costPerKg: { toString(): string } } => lot.costPerKg != null,
    );
    if (lotsWithCost.length > 0) {
      const avgCost = lotsWithCost
        .reduce(
          (sum, lot) => sum.plus(new Decimal(lot.costPerKg.toString())),
          new Decimal(0),
        )
        .div(lotsWithCost.length);
      averageCostPerKg = avgCost.toDecimalPlaces(4).toString();
    }

    return {
      totalExpenses: totalExpenses.toString(),
      totalDiscount: totalDiscount.toString(),
      totalTonnage: totalTonnage.toString(),
      averageCostPerKg,
    };
  }

  /**
   * Attach computed totals to a container object.
   */
  private withTotals(container: any): any {
    if (!container) return container;
    const totals = this.computeTotals(container);
    return { ...container, totals };
  }

  // ---------------------------------------------------------------------------
  // Container CRUD
  // ---------------------------------------------------------------------------

  /**
   * @param finalized - Opt-in filter, backward compatible: omitted (undefined)
   *   returns containers regardless of finalization state — the exact
   *   pre-finalization behavior, so existing callers (SupplierDetail's
   *   per-supplier container list, Dashboard's port-status widget) are
   *   unaffected. `false` excludes finalized containers (the main
   *   Containers page — "active operational work" only). `true` returns
   *   ONLY finalized containers (the History page), sorted finalizedAt
   *   desc, and additionally supports finalizedFrom/finalizedTo.
   * @param finalizedFrom / finalizedTo - "YYYY-MM-DD", only applied when
   *   finalized === true. finalizedAt is a genuine DateTime column (not a
   *   @db.Date), so this uses the same Asia/Beirut zonedMidnightUtc
   *   business-day boundary helper (buildDateFilter) the P&L/reports date
   *   filters already use — never a raw `new Date(str)`/`toISOString()`
   *   UTC-midnight comparison, which would silently misplace same-day
   *   finalizations for a timezone ahead of UTC.
   */
  async findAll(
    page: number,
    limit: number,
    status?: string,
    supplierId?: string,
    search?: string,
    userRole?: string,
    finalized?: boolean,
    finalizedFrom?: string,
    finalizedTo?: string,
  ) {
    const skip = (page - 1) * limit;

    const finalizedDateFilter =
      finalized === true && (finalizedFrom || finalizedTo)
        ? buildDateFilter(finalizedFrom, finalizedTo)
        : undefined;

    const where: Prisma.ContainerWhereInput = {
      ...(status ? { status: status as any } : {}),
      ...(supplierId ? { supplierId } : {}),
      ...(search
        ? { number: { contains: search, mode: 'insensitive' } }
        : {}),
      ...(finalized === true
        ? {
            finalizedAt: {
              not: null,
              ...(finalizedDateFilter?.businessGte ? { gte: finalizedDateFilter.businessGte } : {}),
              ...(finalizedDateFilter?.businessLt ? { lt: finalizedDateFilter.businessLt } : {}),
            },
          }
        : {}),
      ...(finalized === false ? { finalizedAt: null } : {}),
    };

    const [containers, total] = await this.prisma.$transaction([
      this.prisma.container.findMany({
        where,
        skip,
        take: limit,
        orderBy: finalized === true ? { finalizedAt: 'desc' } : { createdAt: 'desc' },
        include: {
          supplier: true,
          productLines: { orderBy: { createdAt: 'asc' } },
          expenses: true,
          discount: true,
          finalizedBy: { select: { id: true, name: true } },
          // kgReceived/kgRemaining only — feeds the Finalize confirmation
          // summary and the History page's "Remaining stock" column
          // without a second request; never the full StockLot relation here.
          stockLots: { select: { kgReceived: true, kgRemaining: true } },
          // Cached tracking summary for the containers-list cards. Reads our
          // DB only — never calls Traqo. `select` (not the full relation)
          // keeps this list-safe: excludes rawResponse (can be large, holds
          // a geo route polyline) and events (only needed on the detail
          // page's dedicated GET .../tracking call), so this stays a single
          // JOIN rather than growing the list payload per container.
          tracking: {
            select: {
              status: true,
              vessel: true,
              voyage: true,
              origin: true,
              destination: true,
              currentLocation: true,
              eta: true,
              lastFetchedAt: true,
            },
          },
        },
      }),
      this.prisma.container.count({ where }),
    ]);

    const data = containers
      .map((c) => this.withTotals(c))
      .map((c) => this.stripCostFields(c, userRole));

    return { data, total, page, limit };
  }

  async findOne(id: string, userRole?: string) {
    const container = await this.prisma.container.findUnique({
      where: { id },
      include: {
        supplier: true,
        productLines: { orderBy: { createdAt: 'asc' } },
        expenses: true,
        discount: true,
        stockLots: { orderBy: { createdAt: 'asc' } },
        finalizedBy: { select: { id: true, name: true } },
      },
    });

    if (!container) {
      throw new NotFoundException({
        error: 'Container not found',
        code: 'NOT_FOUND',
      });
    }

    return this.stripCostFields(this.withTotals(container), userRole);
  }

  async create(dto: CreateContainerDto, userId: string) {
    // Resolve internal user id from clerkId
    const user = await this.prisma.user.findUnique({
      where: { clerkId: userId },
    });
    if (!user) {
      throw new NotFoundException({ error: 'User not found', code: 'NOT_FOUND' });
    }

    // Validate supplier exists
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: dto.supplierId },
    });
    if (!supplier) {
      throw new NotFoundException({
        error: 'Supplier not found',
        code: 'NOT_FOUND',
      });
    }

    const arrivingNow = dto.status === 'arrived';

    try {
    return await this.prisma.$transaction(async (tx) => {
      const container = await tx.container.create({
        data: {
          number: dto.number,
          supplierId: dto.supplierId,
          status: arrivingNow ? 'arrived' : (dto.status as any) ?? 'port',
          ...(arrivingNow ? { arrivalDate: new Date() } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(dto.sealine !== undefined ? { sealine: dto.sealine } : {}),
          ...(dto.sealineName !== undefined ? { sealineName: dto.sealineName } : {}),
          createdById: user.id,
        },
      });

      if (dto.productLines?.length) {
        await tx.containerProductLine.createMany({
          data: dto.productLines.map((l) => ({
            containerId: container.id,
            charcoalType: l.charcoalType,
            grade: l.grade,
            supplierId: l.supplierId,
            paidBags: l.paidBags,
            giftBags: l.giftBags ?? 0,
            kgPerBag: l.kgPerBag,
            pricePerTon: l.pricePerTon,
          })),
        });
      }

      // If created with arrived status, create stock lots immediately.
      if (arrivingNow && dto.productLines?.length) {
        const productLines = await tx.containerProductLine.findMany({
          where: { containerId: container.id },
          orderBy: { createdAt: 'asc' },
        });

        // BUG-1 (P1): bind each lot to its product line via productLineId FK.
        // One create per line (not createMany) so the FK is set per row.
        for (const line of productLines) {
          const kgReceived = new Decimal(line.paidBags)
            .mul(new Decimal(line.kgPerBag.toString()))
            .toFixed(3);
          await tx.stockLot.create({
            data: {
              charcoalType: line.charcoalType,
              grade:        line.grade,
              supplierId:   line.supplierId,
              kgReceived,
              kgRemaining:  kgReceived,
              costPerKg:    '0',
              source:       'container',
              containerId:  container.id,
              productLineId: line.id,
              dateReceived: new Date(),
            },
          });
        }

        await this.recalculateContainerCosts(container.id, tx);
      }

      return tx.container.findUniqueOrThrow({
        where: { id: container.id },
        include: { supplier: true, productLines: true, expenses: true, discount: true },
      });
    });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({ error: 'A container with this number already exists', code: 'CONFLICT' });
      }
      throw e;
    }
  }

  async update(id: string, dto: UpdateContainerDto, userId: string) {
    // Verify container exists
    const existing = await this.prisma.container.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        error: 'Container not found',
        code: 'NOT_FOUND',
      });
    }

    // Finalized containers: number/supplier/carrier/status are all locked —
    // this is also what closes the "status can revert via a direct API
    // call" gap for finalized containers specifically (status is included
    // below). `notes` is deliberately NOT in this list — it carries no
    // financial/identity meaning and stays editable, same as before.
    // Finalized containers: number/supplier/carrier/status are all locked —
    // this is also what closes the "status can revert via a direct API
    // call" gap for finalized containers specifically (status is included
    // below). `notes` is deliberately NOT in this list — it carries no
    // financial/identity meaning and stays editable, same as before.
    if (existing.finalizedAt) {
      const attemptsLockedField =
        dto.number !== undefined ||
        dto.supplierId !== undefined ||
        dto.sealine !== undefined ||
        dto.sealineName !== undefined ||
        dto.status !== undefined;
      if (attemptsLockedField) {
        this.assertNotFinalized(existing);
      }
    }

    // Arrival transition: transactional with StockLot creation
    // Arrival: creates one StockLot per product line then recalculates all costPerKg; 10 s is generous for typical containers (3-10 lines).
    if (dto.status === 'arrived') {
      await this.prisma.$transaction(async (tx) => {
        // Step 1: Re-read the container with product lines inside the transaction for a consistent snapshot.
        const container = await tx.container.findUnique({
          where: { id },
          include: { productLines: { orderBy: { createdAt: 'asc' } } },
        });

        // Step 2: Guard — already arrived (idempotency), missing product lines (would cause zero tonnage).
        if (!container) {
          throw new NotFoundException({
            error: 'Container not found',
            code: 'NOT_FOUND',
          });
        }

        if (container.status === 'arrived') {
          throw new ConflictException({
            error: 'Container is already arrived',
            code: 'ALREADY_ARRIVED',
          });
        }

        if (container.productLines.length === 0) {
          throw new BadRequestException({
            error: 'Container must have at least one product line before arrival',
            code: 'NO_PRODUCT_LINES',
          });
        }

        // Step 3: Flip status and stamp arrivalDate on the container row.
        await tx.container.update({
          where: { id },
          data: {
            status: 'arrived',
            arrivalDate: new Date(),
            ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          },
        });

        // Step 4: Create exactly one StockLot per product line (CONSTRAINT 8 — never merge).
        //         kgReceived = paidBags × kgPerBag (decimal.js). costPerKg seeded as "0" — overwritten in step 5.
        //         BUG-1 (P1): each lot persists productLineId — its real FK to the originating
        //         line — so cost recalculation joins by key, never by createdAt array index.
        //         Created one-by-one (not createMany) because the FK must be bound per row.
        for (const line of container.productLines) {
          const kgReceived = new Decimal(line.paidBags)
            .mul(new Decimal(line.kgPerBag.toString()))
            .toFixed(3);
          await tx.stockLot.create({
            data: {
              charcoalType: line.charcoalType,
              grade: line.grade,
              supplierId: line.supplierId,
              kgReceived,
              kgRemaining: kgReceived,
              costPerKg: '0', // placeholder — recalculated below
              source: 'container',
              containerId: id,
              productLineId: line.id,
              dateReceived: new Date(),
            },
          });
        }

        // Step 5: Recalculate costPerKg on all lots just created (CONSTRAINT 9).
        await this.recalculateContainerCosts(id, tx);
      }, { timeout: 10_000, maxWait: 5_000 });

      // Phase C: the container has now genuinely transitioned to 'arrived'
      // (the transaction above throws ALREADY_ARRIVED before ever reaching
      // this line otherwise — see Step 2 — so every execution that gets
      // here is a real not-arrived -> arrived transition, never a repeat).
      // Deliberately AFTER the transaction commits and wrapped so a
      // notification failure can never affect the arrival response itself.
      try {
        await this.notifications.notifyArrivalIfNeeded(id);
      } catch (e) {
        this.logger.error(
          `Arrival notification dispatch failed for container ${id} — arrival itself already succeeded and is unaffected.`,
          e instanceof Error ? e.stack : String(e),
        );
      }

      // Step 6: Return the updated container with all relations for the HTTP response.
      return this.prisma.container.findUnique({
        where: { id },
        include: {
          supplier: true,
          productLines: { orderBy: { createdAt: 'asc' } },
          expenses: true,
          discount: true,
          stockLots: { orderBy: { createdAt: 'asc' } },
        },
      });
    }

    // Non-arrival update (e.g. notes, status to transit)
    const updateData: Prisma.ContainerUpdateInput = {};
    if (dto.number !== undefined) updateData.number = dto.number;
    if (dto.supplierId !== undefined) updateData.supplier = { connect: { id: dto.supplierId } };
    if (dto.status !== undefined) updateData.status = dto.status as any;
    if (dto.notes !== undefined) updateData.notes = dto.notes;
    if (dto.sealine !== undefined) updateData.sealine = dto.sealine;
    if (dto.sealineName !== undefined) updateData.sealineName = dto.sealineName;

    try {
      return await this.prisma.container.update({
        where: { id },
        data: updateData,
        include: {
          supplier: true,
          productLines: { orderBy: { createdAt: 'asc' } },
          expenses: true,
          discount: true,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({ error: 'A container with this number already exists', code: 'CONFLICT' });
      }
      throw e;
    }
  }

  // ---------------------------------------------------------------------------
  // Finalization
  // ---------------------------------------------------------------------------

  /**
   * Finalize an arrived container: locks its financial/identity record by
   * stamping finalizedAt/finalizedById. Deliberately does NOT touch
   * StockLot, ContainerProductLine, ContainerExpense, or ContainerDiscount
   * rows, and does NOT call recalculateContainerCosts() — the container's
   * cost is already fully computed by the normal arrived-container flow;
   * finalization only freezes the CURRENT value by making every future
   * write to expenses/discounts rejected (see assertNotFinalized() and its
   * call sites), never by recomputing anything here.
   *
   * Race-safe/idempotent by construction: the actual write is a conditional
   * `updateMany` matching `status: 'arrived', finalizedAt: null` — two
   * concurrent finalize calls can never both succeed. The loser's `count`
   * comes back 0 and is reported as CONTAINER_ALREADY_FINALIZED, the same
   * error a genuine second request gets.
   */
  async finalize(id: string, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { clerkId: userId },
    });
    if (!user) {
      throw new NotFoundException({ error: 'User not found', code: 'NOT_FOUND' });
    }

    const container = await this.prisma.container.findUnique({
      where: { id },
    });
    if (!container) {
      throw new NotFoundException({
        error: 'Container not found',
        code: 'NOT_FOUND',
      });
    }
    if (container.status !== 'arrived') {
      throw new BadRequestException({
        error: 'Only an arrived container can be finalized.',
        code: 'CONTAINER_NOT_ARRIVED',
      });
    }
    if (container.finalizedAt) {
      throw new ConflictException({
        error: 'This container has already been finalized.',
        code: 'CONTAINER_ALREADY_FINALIZED',
      });
    }

    const result = await this.prisma.container.updateMany({
      where: { id, status: 'arrived', finalizedAt: null },
      data: { finalizedAt: new Date(), finalizedById: user.id },
    });

    if (result.count === 0) {
      // Lost a concurrent race with another finalize request.
      throw new ConflictException({
        error: 'This container has already been finalized.',
        code: 'CONTAINER_ALREADY_FINALIZED',
      });
    }

    return this.prisma.container.findUniqueOrThrow({
      where: { id },
      include: {
        supplier: true,
        productLines: { orderBy: { createdAt: 'asc' } },
        expenses: true,
        discount: true,
        stockLots: { orderBy: { createdAt: 'asc' } },
        finalizedBy: { select: { id: true, name: true } },
      },
    });
  }

  async remove(id: string): Promise<void> {
    const container = await this.prisma.container.findUnique({
      where: { id },
    });

    if (!container) {
      throw new NotFoundException({
        error: 'Container not found',
        code: 'NOT_FOUND',
      });
    }

    if (container.status === 'arrived') {
      throw new ConflictException({
        error: 'Cannot delete an arrived container',
        code: 'CONTAINER_ARRIVED',
      });
    }

    await this.prisma.container.delete({ where: { id } });
  }

  // ---------------------------------------------------------------------------
  // Stock lots
  // ---------------------------------------------------------------------------

  async findStockLots(containerId: string) {
    const container = await this.prisma.container.findUnique({
      where: { id: containerId },
    });

    if (!container) {
      throw new NotFoundException({
        error: 'Container not found',
        code: 'NOT_FOUND',
      });
    }

    return this.prisma.stockLot.findMany({
      where: { containerId, source: 'container' },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ---------------------------------------------------------------------------
  // Product lines
  // ---------------------------------------------------------------------------

  async findProductLines(containerId: string, userRole?: string) {
    const container = await this.prisma.container.findUnique({
      where: { id: containerId },
    });

    if (!container) {
      throw new NotFoundException({
        error: 'Container not found',
        code: 'NOT_FOUND',
      });
    }

    const lines = await this.prisma.containerProductLine.findMany({
      where: { containerId },
      orderBy: { createdAt: 'asc' },
    });

    if (userRole === 'sales_rep') {
      return lines.map((line: any) => {
        const l = { ...line };
        delete l.pricePerTon;
        delete l.allInCostPerKg;
        return l;
      });
    }

    return lines;
  }

  async createProductLine(
    containerId: string,
    dto: CreateProductLineDto,
  ) {
    const container = await this.prisma.container.findUnique({
      where: { id: containerId },
    });

    if (!container) {
      throw new NotFoundException({
        error: 'Container not found',
        code: 'NOT_FOUND',
      });
    }

    // A line added after arrival would have no corresponding StockLot (those
    // are only created by the arrival transition in update()) — its tonnage
    // would still enter recalculateContainerCosts()'s totalTonnage
    // denominator, silently diluting expense/discount allocation across the
    // container's REAL stock lots without ever receiving a share itself.
    // Mirrors updateProductLine()/removeProductLine()'s identical guard.
    if (container.status === 'arrived') {
      throw new BadRequestException({
        error: 'Cannot add a product line to an arrived container',
        code: 'CONTAINER_ARRIVED',
      });
    }

    // Validate supplier
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: dto.supplierId },
    });
    if (!supplier) {
      throw new NotFoundException({
        error: 'Supplier not found',
        code: 'NOT_FOUND',
      });
    }

    const line = await this.prisma.$transaction(async (tx) => {
      const created = await tx.containerProductLine.create({
        data: {
          containerId,
          charcoalType: dto.charcoalType,
          grade: dto.grade,
          supplierId: dto.supplierId,
          paidBags: dto.paidBags,
          giftBags: dto.giftBags ?? 0,
          kgPerBag: dto.kgPerBag,
          pricePerTon: dto.pricePerTon,
        },
      });

      // Recalculate if arrived (CONSTRAINT 9) — dead branch now that the guard
      // above rejects this call entirely on an arrived container; left in
      // place rather than removed, since it is otherwise correct and this is
      // a bug-fix pass, not a refactor.
      if (container.status === 'arrived') {
        await this.recalculateContainerCosts(containerId, tx);
      }

      return created;
    });

    return line;
  }

  async updateProductLine(
    containerId: string,
    lineId: string,
    dto: UpdateProductLineDto,
  ) {
    const container = await this.prisma.container.findUnique({
      where: { id: containerId },
    });

    if (!container) {
      throw new NotFoundException({
        error: 'Container not found',
        code: 'NOT_FOUND',
      });
    }

    // Mirrors removeProductLine()'s guard: once a container has arrived, its
    // StockLot.kgReceived/kgRemaining are fixed at arrival-time
    // (paidBags × kgPerBag) and are never re-synced by recalculateContainerCosts
    // (which only rewrites costPerKg). Editing paidBags/kgPerBag/pricePerTon
    // here after arrival would recompute cost allocation against a tonnage
    // that no longer matches the physical stock already received, silently
    // desyncing costPerKg from the actual kg on hand.
    if (container.status === 'arrived') {
      throw new BadRequestException({
        error: 'Cannot edit a product line on an arrived container',
        code: 'CONTAINER_ARRIVED',
      });
    }

    const line = await this.prisma.containerProductLine.findFirst({
      where: { id: lineId, containerId },
    });

    if (!line) {
      throw new NotFoundException({
        error: 'Product line not found',
        code: 'NOT_FOUND',
      });
    }

    if (dto.supplierId !== undefined) {
      const supplier = await this.prisma.supplier.findUnique({
        where: { id: dto.supplierId },
      });
      if (!supplier) {
        throw new NotFoundException({
          error: 'Supplier not found',
          code: 'NOT_FOUND',
        });
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const updateData: Prisma.ContainerProductLineUpdateInput = {};
      if (dto.charcoalType !== undefined) updateData.charcoalType = dto.charcoalType;
      if (dto.grade !== undefined) updateData.grade = dto.grade;
      if (dto.supplierId !== undefined) updateData.supplier = { connect: { id: dto.supplierId } };
      if (dto.paidBags !== undefined) updateData.paidBags = dto.paidBags;
      if (dto.giftBags !== undefined) updateData.giftBags = dto.giftBags;
      if (dto.kgPerBag !== undefined) updateData.kgPerBag = dto.kgPerBag;
      if (dto.pricePerTon !== undefined) updateData.pricePerTon = dto.pricePerTon;

      const updated = await tx.containerProductLine.update({
        where: { id: lineId },
        data: updateData,
      });

      // Recalculate after any product line change (CONSTRAINT 9)
      await this.recalculateContainerCosts(containerId, tx);

      return updated;
    });
  }

  async removeProductLine(containerId: string, lineId: string): Promise<void> {
    const container = await this.prisma.container.findUnique({
      where: { id: containerId },
    });

    if (!container) {
      throw new NotFoundException({
        error: 'Container not found',
        code: 'NOT_FOUND',
      });
    }

    if (container.status === 'arrived') {
      throw new BadRequestException({
        error: 'Cannot delete a product line from an arrived container',
        code: 'CONTAINER_ARRIVED',
      });
    }

    const line = await this.prisma.containerProductLine.findFirst({
      where: { id: lineId, containerId },
    });

    if (!line) {
      throw new NotFoundException({
        error: 'Product line not found',
        code: 'NOT_FOUND',
      });
    }

    await this.prisma.containerProductLine.delete({ where: { id: lineId } });
  }

  // ---------------------------------------------------------------------------
  // Expenses
  // ---------------------------------------------------------------------------

  async findExpenses(containerId: string) {
    const container = await this.prisma.container.findUnique({
      where: { id: containerId },
    });

    if (!container) {
      throw new NotFoundException({
        error: 'Container not found',
        code: 'NOT_FOUND',
      });
    }

    return this.prisma.containerExpense.findMany({
      where: { containerId },
      orderBy: { addedAt: 'asc' },
    });
  }

  async createExpense(
    containerId: string,
    dto: CreateExpenseDto,
    userId: string,
  ) {
    const container = await this.prisma.container.findUnique({
      where: { id: containerId },
    });

    if (!container) {
      throw new NotFoundException({
        error: 'Container not found',
        code: 'NOT_FOUND',
      });
    }
    this.assertNotFinalized(container);

    const user = await this.prisma.user.findUnique({
      where: { clerkId: userId },
    });
    if (!user) {
      throw new NotFoundException({ error: 'User not found', code: 'NOT_FOUND' });
    }

    return this.prisma.$transaction(async (tx) => {
      const expense = await tx.containerExpense.create({
        data: {
          containerId,
          description: dto.description,
          amount: dto.amount,
          addedById: user.id,
        },
      });

      // CONSTRAINT 9: recalculate after expense write
      await this.recalculateContainerCosts(containerId, tx);

      return expense;
    });
  }

  async updateExpense(
    containerId: string,
    expenseId: string,
    dto: UpdateExpenseDto,
  ) {
    const container = await this.prisma.container.findUnique({
      where: { id: containerId },
    });

    if (!container) {
      throw new NotFoundException({
        error: 'Container not found',
        code: 'NOT_FOUND',
      });
    }
    this.assertNotFinalized(container);

    const expense = await this.prisma.containerExpense.findFirst({
      where: { id: expenseId, containerId },
    });

    if (!expense) {
      throw new NotFoundException({
        error: 'Expense not found',
        code: 'NOT_FOUND',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const updateData: Prisma.ContainerExpenseUpdateInput = {};
      if (dto.description !== undefined) updateData.description = dto.description;
      if (dto.amount !== undefined) updateData.amount = dto.amount;

      const updated = await tx.containerExpense.update({
        where: { id: expenseId },
        data: updateData,
      });

      // CONSTRAINT 9: recalculate after expense write
      await this.recalculateContainerCosts(containerId, tx);

      return updated;
    });
  }

  async removeExpense(containerId: string, expenseId: string): Promise<void> {
    const container = await this.prisma.container.findUnique({
      where: { id: containerId },
    });

    if (!container) {
      throw new NotFoundException({
        error: 'Container not found',
        code: 'NOT_FOUND',
      });
    }
    this.assertNotFinalized(container);

    const expense = await this.prisma.containerExpense.findFirst({
      where: { id: expenseId, containerId },
    });

    if (!expense) {
      throw new NotFoundException({
        error: 'Expense not found',
        code: 'NOT_FOUND',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.containerExpense.delete({ where: { id: expenseId } });

      // CONSTRAINT 9: recalculate after expense delete
      await this.recalculateContainerCosts(containerId, tx);
    });
  }

  // ---------------------------------------------------------------------------
  // Discount
  // ---------------------------------------------------------------------------

  async findDiscount(containerId: string) {
    const container = await this.prisma.container.findUnique({
      where: { id: containerId },
    });

    if (!container) {
      throw new NotFoundException({
        error: 'Container not found',
        code: 'NOT_FOUND',
      });
    }

    return this.prisma.containerDiscount.findUnique({
      where: { containerId },
    });
  }

  async upsertDiscount(containerId: string, dto: UpsertDiscountDto) {
    const container = await this.prisma.container.findUnique({
      where: { id: containerId },
    });

    if (!container) {
      throw new NotFoundException({
        error: 'Container not found',
        code: 'NOT_FOUND',
      });
    }
    this.assertNotFinalized(container);

    return this.prisma.$transaction(async (tx) => {
      const discount = await tx.containerDiscount.upsert({
        where: { containerId },
        create: {
          containerId,
          amount: dto.amount,
        },
        update: {
          amount: dto.amount,
        },
      });

      // CONSTRAINT 9: recalculate after discount write
      await this.recalculateContainerCosts(containerId, tx);

      return discount;
    });
  }

  async removeDiscount(containerId: string): Promise<void> {
    const container = await this.prisma.container.findUnique({
      where: { id: containerId },
    });

    if (!container) {
      throw new NotFoundException({
        error: 'Container not found',
        code: 'NOT_FOUND',
      });
    }
    this.assertNotFinalized(container);

    const discount = await this.prisma.containerDiscount.findUnique({
      where: { containerId },
    });

    if (!discount) {
      throw new NotFoundException({
        error: 'Discount not found',
        code: 'NOT_FOUND',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.containerDiscount.delete({ where: { containerId } });

      // CONSTRAINT 9: recalculate after discount delete
      await this.recalculateContainerCosts(containerId, tx);
    });
  }
}
