import { Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitPhysicalCountDto } from './dto/physical-count.dto';

interface DateRangeFilter {
  gte?: Date;
  lte?: Date;
}

function buildDateFilter(from?: string, to?: string): DateRangeFilter | undefined {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: new Date(from) } : {}),
    ...(to ? { lte: new Date(to) } : {}),
  };
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * P&L report — CONSTRAINT 11: restricted to owner role.
   * Aggregates revenue, cogs, bag_cost, variance_cost, delivery_cost and derives gross_profit.
   * All arithmetic uses decimal.js to avoid floating-point error on monetary values.
   *
   * @constraint 11 gross_profit visible to owner only — enforced at controller level.
   *
   * Formula:
   *   revenue       = Σ invoice.lines[].lineTotal  (issued/partially_paid/paid invoices)
   *   cogs          = Σ exit.quantity × bagType.nominalKg × lot.costPerKg  (order/walk_in exits)
   *   bag_cost      = Σ bagPurchase.totalCost
   *   variance_cost = Σ |session.varianceKg| × lot.costPerKg  (sessions where varianceKg < 0)
   *   delivery_cost = Σ trip.fuelCost + Σ trip.otherExpenses[].amount
   *   gross_profit  = revenue − cogs − bag_cost − variance_cost − delivery_cost
   */
  async getProfitLoss(filters: {
    dateFrom?: string;
    dateTo?: string;
    charcoalType?: string;
    grade?: string;
    clientId?: string;
  }) {
    const dateFilter = buildDateFilter(filters.dateFrom, filters.dateTo);

    // revenue: sum lineTotal from issued/partially_paid/paid invoice lines
    const invoices = await this.prisma.invoice.findMany({
      where: {
        status: { in: ['issued', 'partially_paid', 'paid'] },
        ...(dateFilter ? { issuedAt: dateFilter } : {}),
        ...(filters.clientId ? { clientId: filters.clientId } : {}),
      },
    });

    let revenue = new Decimal(0);
    for (const inv of invoices) {
      const lines = inv.lines as Array<{ lineTotal: string | number }>;
      for (const line of lines) {
        revenue = revenue.plus(new Decimal(line.lineTotal.toString()));
      }
    }

    // Also count warehouse walk-in sales that have a stored sale amount
    const warehouseSaleRevenue = await this.prisma.stockExit.findMany({
      where: {
        exitType: 'walk_in',
        amount: { not: null },
        ...(dateFilter ? { date: dateFilter } : {}),
        ...(filters.clientId ? { clientId: filters.clientId } : {}),
      },
      select: { amount: true },
    });
    for (const exit of warehouseSaleRevenue) {
      if (exit.amount != null) {
        revenue = revenue.plus(new Decimal(exit.amount.toString()));
      }
    }

    // cogs: sale-type exits (order / walk_in)
    // Packed mode: qty × bagType.nominalKg × lot.costPerKg
    // Raw lot mode: kgQuantity × lot.costPerKg
    const stockExits = await this.prisma.stockExit.findMany({
      where: {
        exitType: { in: ['order', 'walk_in'] },
        ...(dateFilter ? { date: dateFilter } : {}),
      },
      include: {
        packedStock: { include: { lot: true } },
        bagType: true,
        lot: true,
      },
    });

    let cogs = new Decimal(0);
    for (const exit of stockExits) {
      if (exit.lotId && exit.kgQuantity != null && exit.lot?.costPerKg != null) {
        // By-kg raw lot exit
        const kg = new Decimal(exit.kgQuantity.toString());
        const costPerKg = new Decimal(exit.lot.costPerKg.toString());
        cogs = cogs.plus(kg.times(costPerKg));
      } else if (exit.quantity != null && exit.bagType?.nominalKg != null && exit.packedStock?.lot?.costPerKg != null) {
        // Packed bag exit
        const qty = new Decimal(exit.quantity);
        const nominalKg = new Decimal(exit.bagType.nominalKg.toString());
        const costPerKg = new Decimal(exit.packedStock.lot.costPerKg.toString());
        cogs = cogs.plus(qty.times(nominalKg).times(costPerKg));
      }
    }

    // bag_cost: sum BagPurchase.totalCost in period
    const bagPurchases = await this.prisma.bagPurchase.findMany({
      where: {
        ...(dateFilter ? { date: dateFilter } : {}),
      },
    });

    let bagCost = new Decimal(0);
    for (const bp of bagPurchases) {
      bagCost = bagCost.plus(new Decimal(bp.totalCost.toString()));
    }

    // variance_cost: sessions where varianceKg < 0 — indicates over-output (error)
    const varianceSessions = await this.prisma.packingSession.findMany({
      where: {
        varianceKg: { lt: 0 },
        ...(dateFilter ? { date: dateFilter } : {}),
      },
      include: { sessionLots: { include: { lot: { select: { costPerKg: true } } } } },
    });

    let varianceCost = new Decimal(0);
    for (const session of varianceSessions) {
      const absVariance = new Decimal(session.varianceKg.toString()).abs();
      // Weighted average costPerKg across all lots used in this session
      const totalKg = session.sessionLots.reduce((s, sl) => s.plus(sl.kgUsed.toString()), new Decimal(0));
      const weightedCost = session.sessionLots.reduce((s, sl) => {
        return s.plus(new Decimal(sl.lot.costPerKg.toString()).mul(sl.kgUsed.toString()));
      }, new Decimal(0));
      const avgCostPerKg = totalKg.gt(0) ? weightedCost.div(totalKg) : new Decimal(0);
      varianceCost = varianceCost.plus(absVariance.times(avgCostPerKg));
    }

    // delivery_cost: completed trips' fuelCost + otherExpenses[].amount
    const trips = await this.prisma.driverTrip.findMany({
      where: {
        status: 'completed',
        ...(dateFilter ? { completedAt: dateFilter } : {}),
      },
    });

    let deliveryCost = new Decimal(0);
    for (const trip of trips) {
      if (trip.fuelCost) {
        deliveryCost = deliveryCost.plus(new Decimal(trip.fuelCost.toString()));
      }
      const expenses = trip.otherExpenses as Array<{ amount: string | number }>;
      for (const exp of expenses) {
        deliveryCost = deliveryCost.plus(new Decimal(exp.amount.toString()));
      }
    }

    // gross_profit = revenue − cogs − bag_cost − variance_cost − delivery_cost
    const grossProfit = revenue
      .minus(cogs)
      .minus(bagCost)
      .minus(varianceCost)
      .minus(deliveryCost);

    return {
      from: filters.dateFrom ?? null,
      to: filters.dateTo ?? null,
      revenue: revenue.toFixed(2),
      cogs: cogs.toFixed(2),
      bagCost: bagCost.toFixed(2),
      varianceCost: varianceCost.toFixed(2),
      deliveryCost: deliveryCost.toFixed(2),
      grossProfit: grossProfit.toFixed(2),
    };
  }

  /**
   * Stock value report — CONSTRAINT 12: costPerKg visible to owner/accountant only.
   * Returns per-lot value (kgRemaining × costPerKg) and totalValue.
   *
   * @constraint 12 costPerKg must not be returned to sales_rep or worker — enforced at controller.
   */
  async getStockValue() {
    const lots = await this.prisma.stockLot.findMany({
      where: { kgRemaining: { gt: 0 } },
      orderBy: { createdAt: 'desc' },
    });

    let totalValue = new Decimal(0);
    const lotItems = lots.map((lot) => {
      const kgRemaining = new Decimal(lot.kgRemaining.toString());
      const costPerKg = new Decimal(lot.costPerKg.toString());
      const lotValue = kgRemaining.times(costPerKg);
      totalValue = totalValue.plus(lotValue);
      return {
        lotId: lot.id,
        charcoalType: lot.charcoalType,
        grade: lot.grade,
        kgRemaining: kgRemaining.toFixed(3),
        costPerKg: costPerKg.toFixed(4),
        lotValue: lotValue.toFixed(2),
      };
    });

    return {
      lots: lotItems,
      totalValue: totalValue.toFixed(2),
    };
  }

  /**
   * Variance report — shows packing session variance per session in date range.
   * Optional workerId filter maps to PackingSession.workerId (User.id).
   */
  async getVariance(filters: { dateFrom?: string; dateTo?: string; workerId?: string }) {
    const dateFilter = buildDateFilter(filters.dateFrom, filters.dateTo);

    const sessions = await this.prisma.packingSession.findMany({
      where: {
        ...(dateFilter ? { date: dateFilter } : {}),
        ...(filters.workerId ? { workerId: filters.workerId } : {}),
      },
      include: {
        worker: true,
        sessionLots: { include: { lot: { select: { id: true, charcoalType: true, grade: true, costPerKg: true } } } },
      },
      orderBy: { date: 'asc' },
    });

    let totalVarianceKg = new Decimal(0);
    let totalVarianceCost = new Decimal(0);

    const rows = sessions.map((session) => {
      const varianceKg = new Decimal(session.varianceKg.toString());
      // Weighted average costPerKg across all lots used
      const totalKg = session.sessionLots.reduce((s, sl) => s.plus(sl.kgUsed.toString()), new Decimal(0));
      const weightedCost = session.sessionLots.reduce((s, sl) => {
        return s.plus(new Decimal(sl.lot.costPerKg.toString()).mul(sl.kgUsed.toString()));
      }, new Decimal(0));
      const avgCostPerKg = totalKg.gt(0) ? weightedCost.div(totalKg) : new Decimal(0);
      const varianceCost = varianceKg.abs().times(avgCostPerKg);
      totalVarianceKg = totalVarianceKg.plus(varianceKg);
      totalVarianceCost = totalVarianceCost.plus(varianceCost);

      return {
        sessionId: session.id,
        date: session.date,
        workerId: session.workerId,
        workerName: session.worker.name,
        lots: session.sessionLots.map(sl => ({ lotId: sl.lotId, charcoalType: sl.lot.charcoalType, grade: sl.lot.grade, kgUsed: sl.kgUsed.toString() })),
        kgConsumed: new Decimal(session.kgConsumed.toString()).toFixed(3),
        kgOutputTotal: new Decimal(session.kgOutputTotal.toString()).toFixed(3),
        varianceKg: varianceKg.toFixed(3),
        varianceNote: session.varianceNote,
        varianceCost: varianceCost.toFixed(2),
      };
    });

    return {
      from: filters.dateFrom ?? null,
      to: filters.dateTo ?? null,
      rows,
      totalVarianceKg: totalVarianceKg.toFixed(3),
      totalVarianceCost: totalVarianceCost.toFixed(2),
    };
  }

  /**
   * Container costs report — computes allInCostPerKg per product line using the same
   * formula as the containers service.
   *
   * Formula (per product line):
   *   tonnage         = paidBags × kgPerBag / 1000
   *   expenseShare    = totalExpenses × (tonnage / totalTonnage)
   *   discountShare   = totalDiscount × (tonnage / totalTonnage)
   *   allInCostPerTon = pricePerTon + expenseShare/tonnage − discountShare/tonnage
   *   allInCostPerKg  = allInCostPerTon / 1000
   */
  async getContainerCosts(filters: { dateFrom?: string; dateTo?: string; supplierId?: string }) {
    const dateFilter = buildDateFilter(filters.dateFrom, filters.dateTo);

    const containers = await this.prisma.container.findMany({
      where: {
        status: 'arrived',
        ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
        ...(dateFilter ? { arrivalDate: dateFilter } : {}),
      },
      include: {
        supplier: true,
        productLines: { orderBy: { createdAt: 'asc' } },
        expenses: true,
        discount: true,
      },
      orderBy: { arrivalDate: 'desc' },
    });

    return containers.map((container) => {
      const totalExpenses = container.expenses.reduce(
        (sum, e) => sum.plus(new Decimal(e.amount.toString())),
        new Decimal(0),
      );
      const totalDiscount = container.discount
        ? new Decimal(container.discount.amount.toString())
        : new Decimal(0);

      const linesWith = container.productLines.map((line) => {
        const paidBags = new Decimal(line.paidBags);
        const kgPerBag = new Decimal(line.kgPerBag.toString());
        const pricePerTon = new Decimal(line.pricePerTon.toString());
        const tonnage = paidBags.times(kgPerBag).div(1000);
        return { line, tonnage, pricePerTon, kgPerBag };
      });

      const totalTonnage = linesWith.reduce((sum, l) => sum.plus(l.tonnage), new Decimal(0));

      const productLines = linesWith.map(({ line, tonnage, pricePerTon, kgPerBag }) => {
        const expenseShare = totalTonnage.gt(0)
          ? totalExpenses.times(tonnage.div(totalTonnage))
          : new Decimal(0);
        const discountShare = totalTonnage.gt(0)
          ? totalDiscount.times(tonnage.div(totalTonnage))
          : new Decimal(0);
        const allInCostPerTon =
          tonnage.gt(0)
            ? pricePerTon.plus(expenseShare.div(tonnage)).minus(discountShare.div(tonnage))
            : pricePerTon;
        const allInCostPerKg = allInCostPerTon.div(1000);

        return {
          id: line.id,
          charcoalType: line.charcoalType,
          grade: line.grade,
          paidBags: line.paidBags,
          giftBags: line.giftBags,
          kgPerBag: kgPerBag.toFixed(3),
          pricePerTon: pricePerTon.toFixed(2),
          computed: {
            tonnage: tonnage.toFixed(3),
            expenseShare: expenseShare.toFixed(2),
            discountShare: discountShare.toFixed(2),
            allInCostPerTon: allInCostPerTon.toFixed(2),
            allInCostPerKg: allInCostPerKg.toFixed(4),
          },
        };
      });

      return {
        containerId: container.id,
        number: container.number,
        supplierName: container.supplier.name,
        arrivalDate: container.arrivalDate,
        productLines,
        totalExpenses: totalExpenses.toFixed(2),
        totalDiscount: totalDiscount.toFixed(2),
        totalTonnage: totalTonnage.toFixed(3),
      };
    });
  }

  /**
   * Client ledger — chronological list of invoices and payments with running balance.
   * CONSTRAINT 15: balance is always computed from records, never stored.
   * Running balance uses decimal.js after each entry.
   */
  async getClientLedger(
    clientId: string,
    filters: { dateFrom?: string; dateTo?: string },
  ) {
    const dateFilter = buildDateFilter(filters.dateFrom, filters.dateTo);

    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!client) {
      throw new NotFoundException({ error: 'Client not found', code: 'NOT_FOUND' });
    }

    const [invoices, payments] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          clientId,
          status: { not: 'draft' },
          ...(dateFilter ? { issuedAt: dateFilter } : {}),
        },
        orderBy: { issuedAt: 'asc' },
      }),
      this.prisma.payment.findMany({
        where: {
          clientId,
          ...(dateFilter ? { date: dateFilter } : {}),
        },
        orderBy: { date: 'asc' },
      }),
    ]);

    type EntryItem =
      | { kind: 'invoice'; date: Date; id: string; total: Decimal }
      | { kind: 'payment'; date: Date; id: string; amount: Decimal };

    const items: EntryItem[] = [
      ...invoices.map((inv) => ({
        kind: 'invoice' as const,
        date: inv.issuedAt ?? inv.createdAt,
        id: inv.id,
        total: new Decimal(inv.total.toString()),
      })),
      ...payments.map((pmt) => ({
        kind: 'payment' as const,
        date: pmt.date instanceof Date ? pmt.date : new Date(pmt.date),
        id: pmt.id,
        amount: new Decimal(pmt.amount.toString()),
      })),
    ];

    items.sort((a, b) => a.date.getTime() - b.date.getTime());

    let runningBalance = new Decimal(0);
    const entries = items.map((item) => {
      if (item.kind === 'invoice') {
        runningBalance = runningBalance.plus(item.total);
        return {
          date: item.date,
          type: 'invoice' as const,
          reference: item.id,
          debit: item.total.toFixed(2),
          credit: '0.00',
          runningBalance: runningBalance.toFixed(2),
        };
      } else {
        runningBalance = runningBalance.minus(item.amount);
        return {
          date: item.date,
          type: 'payment' as const,
          reference: item.id,
          debit: '0.00',
          credit: item.amount.toFixed(2),
          runningBalance: runningBalance.toFixed(2),
        };
      }
    });

    return {
      clientId,
      currency: client.currency,
      entries,
      balance: runningBalance.toFixed(2),
    };
  }

  /**
   * Worker earnings report — CONSTRAINT 11: owner only.
   * Queries PackingSession (via User) for session earnings and WorkerPayment for payments.
   * The workerId param is used as Worker.id for payments and as User.id for packing sessions.
   *
   * @constraint 11 worker financial data visible to owner only.
   */
  async getWorkerEarnings(
    workerId: string,
    filters: { dateFrom?: string; dateTo?: string },
  ) {
    const dateFilter = buildDateFilter(filters.dateFrom, filters.dateTo);

    const worker = await this.prisma.worker.findUnique({ where: { id: workerId } });
    if (!worker) {
      throw new NotFoundException({ error: 'Worker not found', code: 'NOT_FOUND' });
    }

    const [sessions, workerPayments] = await Promise.all([
      this.prisma.packingSession.findMany({
        where: {
          workerId,
          ...(dateFilter ? { date: dateFilter } : {}),
        },
        orderBy: { date: 'asc' },
      }),
      this.prisma.workerPayment.findMany({
        where: {
          workerId,
          ...(dateFilter ? { date: dateFilter } : {}),
        },
        orderBy: { date: 'asc' },
      }),
    ]);

    let totalEarned = new Decimal(0);
    const sessionRows = sessions.map((s) => {
      const earnings = new Decimal(s.sessionEarnings.toString());
      totalEarned = totalEarned.plus(earnings);
      return {
        sessionId: s.id,
        date: s.date,
        sessionEarnings: earnings.toFixed(2),
      };
    });

    let totalPaid = new Decimal(0);
    const paymentRows = workerPayments.map((p) => {
      const amount = new Decimal(p.amount.toString());
      totalPaid = totalPaid.plus(amount);
      return {
        paymentId: p.id,
        date: p.date,
        amount: amount.toFixed(2),
        notes: p.notes,
      };
    });

    const totalOwed = totalEarned.minus(totalPaid);

    return {
      workerId,
      workerName: worker.name,
      from: filters.dateFrom ?? null,
      to: filters.dateTo ?? null,
      sessions: sessionRows,
      payments: paymentRows,
      totalEarned: totalEarned.toFixed(2),
      totalPaid: totalPaid.toFixed(2),
      totalOwed: totalOwed.toFixed(2),
    };
  }

  /**
   * Physical count — returns all PackedStock records with current system quantities.
   * Owner submits actual counts; discrepancies trigger StockAdjustment creation (CONSTRAINT 13).
   */
  async getPhysicalCount() {
    const packedStocks = await this.prisma.packedStock.findMany({
      include: {
        bagType: true,
        lot: true,
      },
      orderBy: [{ bagType: { name: 'asc' } }, { createdAt: 'asc' }],
    });

    const byBagType: Record<
      string,
      { bagTypeId: string; bagTypeName: string; items: { packedStockId: string; lotId: string; quantity: number }[] }
    > = {};

    for (const ps of packedStocks) {
      if (!byBagType[ps.bagTypeId]) {
        byBagType[ps.bagTypeId] = {
          bagTypeId: ps.bagTypeId,
          bagTypeName: ps.bagType.name,
          items: [],
        };
      }
      byBagType[ps.bagTypeId].items.push({
        packedStockId: ps.id,
        lotId: ps.lotId,
        quantity: ps.quantity,
      });
    }

    return {
      generatedAt: new Date(),
      packedStock: Object.values(byBagType),
    };
  }

  /**
   * Submit physical count results — CONSTRAINT 13: for each discrepancy, create a
   * StockAdjustment with approvedById = request.user.userId (owner only).
   * No silent auto-correction: every mismatch produces an explicit adjustment record.
   *
   * @constraint 13 approvedById must come from the authenticated owner, not the request body.
   *
   * @param dto    - Array of {packedStockId, actualQuantity}
   * @param userId - Clerk userId of the authenticated owner
   */
  async submitPhysicalCount(dto: SubmitPhysicalCountDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { clerkId: userId } });
      if (!user) {
        throw new NotFoundException({ error: 'User not found', code: 'NOT_FOUND' });
      }

      const adjustments = [];

      for (const item of dto.items) {
        const ps = await tx.packedStock.findUnique({ where: { id: item.packedStockId } });
        if (!ps) {
          throw new NotFoundException({
            error: `PackedStock ${item.packedStockId} not found`,
            code: 'NOT_FOUND',
          });
        }

        if (item.actualQuantity === ps.quantity) continue;

        const qtyBefore = new Decimal(ps.quantity);
        const qtyAfter = new Decimal(item.actualQuantity);
        const difference = qtyAfter.minus(qtyBefore);

        await tx.packedStock.update({
          where: { id: ps.id },
          data: { quantity: item.actualQuantity },
        });

        const adjustment = await tx.stockAdjustment.create({
          data: {
            adjustmentType: 'packed_stock',
            packedStockId: ps.id,
            qtyBefore: qtyBefore.toFixed(3),
            qtyAfter: qtyAfter.toFixed(3),
            difference: difference.toFixed(3),
            reason: 'physical count',
            countedById: user.id,
            approvedById: user.id,
            date: new Date(),
          },
        });

        adjustments.push(adjustment);
      }

      return {
        adjustmentsCreated: adjustments.length,
        details: adjustments,
      };
    });
  }

  /**
   * Unified activity feed — aggregates recent events from all major domains,
   * merges them in memory, and returns the most recent `limit` items sorted
   * newest-first.
   *
   * Sources: packing sessions, delivered shipments, payments, issued invoices,
   *          client orders, fill jobs, arrived containers, stock exits.
   */
  async getActivity(limit: number) {
    const PER_SOURCE = Math.max(limit, 20); // fetch enough from each source

    const [
      packingSessions,
      shipments,
      payments,
      invoices,
      orders,
      fillJobs,
      containers,
      exits,
    ] = await Promise.all([
      this.prisma.packingSession.findMany({
        take: PER_SOURCE,
        orderBy: { startedAt: 'desc' },
        include: {
          workerEntity: { select: { name: true } },
          worker: { select: { name: true } },
        },
      }),
      this.prisma.shipment.findMany({
        where: { status: 'delivered' },
        take: PER_SOURCE,
        orderBy: { deliveredAt: 'desc' },
        include: {
          order: { include: { client: { select: { name: true } } } },
          bags: { select: { quantity: true } },
        },
      }),
      this.prisma.payment.findMany({
        take: PER_SOURCE,
        orderBy: { createdAt: 'desc' },
        include: { client: { select: { name: true } } },
      }),
      this.prisma.invoice.findMany({
        where: { issuedAt: { not: null } },
        take: PER_SOURCE,
        orderBy: { issuedAt: 'desc' },
        include: { client: { select: { name: true } } },
      }),
      this.prisma.clientOrder.findMany({
        take: PER_SOURCE,
        orderBy: { createdAt: 'desc' },
        include: { client: { select: { name: true } } },
      }),
      this.prisma.fillJob.findMany({
        take: PER_SOURCE,
        orderBy: { createdAt: 'desc' },
        include: { client: { select: { name: true } } },
      }),
      this.prisma.container.findMany({
        where: { status: 'arrived' },
        take: PER_SOURCE,
        orderBy: { updatedAt: 'desc' },
        include: { supplier: { select: { name: true } } },
      }),
      this.prisma.stockExit.findMany({
        take: PER_SOURCE,
        orderBy: { createdAt: 'desc' },
        include: { client: { select: { name: true } } },
      }),
    ]);

    type ActivityItem = {
      id: string;
      type: string;
      title: string;
      subtitle: string;
      timestamp: string;
    };

    const items: ActivityItem[] = [];

    for (const s of packingSessions) {
      const totalBags = (s.bagsOutput as Array<{ qty: number }>).reduce((acc, b) => acc + (b.qty ?? 0), 0);
      const workerName = s.workerEntity?.name ?? s.worker?.name ?? 'Unknown worker';
      items.push({
        id: `packing-${s.id}`,
        type: 'packing',
        title: `Packing session — ${totalBags} bag${totalBags !== 1 ? 's' : ''}`,
        subtitle: `Worker: ${workerName} · ${parseFloat(s.kgConsumed.toString()).toFixed(0)} kg charcoal in`,
        timestamp: s.startedAt.toISOString(),
      });
    }

    for (const sh of shipments) {
      const clientName = sh.order?.client?.name ?? 'Unknown client';
      const totalBags = sh.bags.reduce((acc, b) => acc + b.quantity, 0);
      const ts = sh.deliveredAt ?? sh.updatedAt;
      items.push({
        id: `delivery-${sh.id}`,
        type: 'delivery',
        title: `Delivery confirmed — ${clientName}`,
        subtitle: `${totalBags} bag${totalBags !== 1 ? 's' : ''}${sh.actualKg ? ` · ${parseFloat(sh.actualKg.toString()).toFixed(0)} kg` : ''}`,
        timestamp: ts.toISOString(),
      });
    }

    for (const p of payments) {
      const amount = parseFloat(p.amount.toString());
      items.push({
        id: `payment-${p.id}`,
        type: 'payment',
        title: `Payment received — ${p.client?.name ?? 'Unknown'}`,
        subtitle: `$${amount.toFixed(0)} ${p.currency} · ${p.method}`,
        timestamp: p.createdAt.toISOString(),
      });
    }

    for (const inv of invoices) {
      const total = parseFloat(inv.total.toString());
      items.push({
        id: `invoice-${inv.id}`,
        type: 'invoice',
        title: `Invoice issued — ${inv.client?.name ?? 'Unknown'}`,
        subtitle: `$${total.toFixed(0)} ${inv.currency} · ${inv.status}`,
        timestamp: inv.issuedAt!.toISOString(),
      });
    }

    for (const o of orders) {
      items.push({
        id: `order-${o.id}`,
        type: 'order',
        title: `Order ${o.status.replace(/_/g, ' ')} — ${o.client?.name ?? 'Unknown'}`,
        subtitle: `${o.charcoalType} · ${o.grade} · ${parseFloat(o.totalKgRequested.toString()).toFixed(0)} kg`,
        timestamp: o.createdAt.toISOString(),
      });
    }

    for (const fj of fillJobs) {
      items.push({
        id: `fill-${fj.id}`,
        type: 'fill',
        title: `Fill job — ${fj.client?.name ?? 'Unknown'}`,
        subtitle: `${fj.totalBags} bag${fj.totalBags !== 1 ? 's' : ''} · ${parseFloat(fj.totalCharcoalKg.toString()).toFixed(0)} kg charcoal`,
        timestamp: fj.createdAt.toISOString(),
      });
    }

    for (const c of containers) {
      items.push({
        id: `container-${c.id}`,
        type: 'container',
        title: `Container arrived — ${c.number}`,
        subtitle: c.supplier?.name ?? 'Unknown supplier',
        timestamp: c.updatedAt.toISOString(),
      });
    }

    for (const ex of exits) {
      const exitLabel = ex.exitType.replace(/_/g, ' ');
      const qty = ex.quantity != null
        ? `${ex.quantity} bag${ex.quantity !== 1 ? 's' : ''}`
        : ex.kgQuantity != null
          ? `${parseFloat(ex.kgQuantity.toString()).toFixed(0)} kg`
          : '';
      const clientPart = ex.client?.name ? ` — ${ex.client.name}` : '';
      items.push({
        id: `exit-${ex.id}`,
        type: 'exit',
        title: `Stock exit · ${exitLabel}${clientPart}`,
        subtitle: qty,
        timestamp: ex.createdAt.toISOString(),
      });
    }

    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return items.slice(0, limit);
  }
}
