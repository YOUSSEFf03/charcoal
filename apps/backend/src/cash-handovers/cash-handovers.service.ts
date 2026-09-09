import { Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerWriteService } from '../ledger/ledger-write.service';
import { BalanceQueryService } from '../ledger/balance-query.service';
import { CreateCashHandoverDto } from './dto/create-cash-handover.dto';

@Injectable()
export class CashHandoversService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerWriteService: LedgerWriteService,
    private readonly balanceQueryService: BalanceQueryService,
  ) {}

  async findAll(page = 1, limit = 20, dateFrom?: string, dateTo?: string, search?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (dateFrom || dateTo) {
      // date is a @db.Date column (business date, not a timestamp) — plain
      // gte/lte is the same convention already used for Payment.date
      // elsewhere in this codebase.
      where.date = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo) } : {}),
      };
    }
    if (search) {
      // receiverName is the historical snapshot (present on every row, even
      // if receiverId is null for legacy data) — searching it, not a live
      // join, matches what a user actually saw at the time. notes is the
      // only other free-text field on this model. Mirrors the OR/contains/
      // insensitive pattern InvoicesService.findAll() already uses.
      where.OR = [
        { receiverName: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.cashHandover.findMany({
        where, skip, take: limit,
        // Newest handover first by its actual business date — createdAt is
        // only a tiebreaker for same-day handovers, so ordering stays
        // deterministic without letting a backdated/late-entered handover's
        // insert time override the date the user filters and reads by.
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        include: {
          loggedBy: { select: { id: true, name: true } },
          receiver: { select: { id: true, name: true } },
          expenses: true,
        },
      }),
      this.prisma.cashHandover.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  /**
   * All users with balance > 0. Delegates to BalanceQueryService (moved there in PR 1
   * of the Cash Management System roadmap — logic unchanged, location only).
   */
  async getAllBalances() {
    return this.balanceQueryService.getAllBalances();
  }

  /**
   * Full balance detail for one user. Delegates to BalanceQueryService (moved there in
   * PR 1 of the Cash Management System roadmap — logic unchanged, location only).
   */
  async getReceiverBalance(receiverId: string) {
    return this.balanceQueryService.getReceiverBalance(receiverId);
  }

  async create(dto: CreateCashHandoverDto, userId: string) {
    const [logger, receiver] = await Promise.all([
      this.prisma.user.findUnique({ where: { clerkId: userId } }),
      this.prisma.user.findUnique({ where: { id: dto.receiverId } }),
    ]);
    if (!logger)   throw new NotFoundException({ error: 'User not found',     code: 'NOT_FOUND' });
    if (!receiver) throw new NotFoundException({ error: 'Receiver not found', code: 'NOT_FOUND' });

    const expected  = parseFloat(dto.expectedAmt);
    const handed    = parseFloat(dto.handedAmt);
    const diff      = handed - expected;
    const handedDec = new Decimal(dto.handedAmt);
    const expenseItems = dto.expenses ?? [];

    // Forensic audit (2026-08-30): itemized expenses are cash the receiver
    // already spent out of the SAME custody being settled here (CONSTRAINT:
    // "kept from collection" means it never physically comes back) — so they
    // must reduce the receiver's ledger balance exactly like the physical
    // handover does. `expected`/`difference` only ever fed the UI's display
    // math; before this fix the ledger debit used `handedDec` alone, so an
    // expense-bearing handover left a permanent residual balance equal to the
    // expense total (proven: $500 held, $40 expense, $460 handed → ledger
    // debited only $460, leaving a $40 balance forever, even though the
    // receiver's custody was fully accounted for). Settling both here is a
    // single ledger entry — no separate expense entry exists anywhere else
    // (CashHandoverExpense is display/reporting-only, see reports.service.ts),
    // so this cannot double-count.
    //
    // UNCHANGED by the 2026-08-31 category redesign below: this sum is still
    // computed purely from `e.amount` (never from category identity), so
    // settledDec/the ledger debit is byte-identical to before that change.
    const expensesTotal = expenseItems.reduce(
      (sum, e) => sum.plus(new Decimal(e.amount)),
      new Decimal(0),
    );
    const settledDec = handedDec.plus(expensesTotal);

    // Forensic audit (2026-08-31): resolve every expense's category BEFORE
    // opening the transaction (same "validate before writing anything"
    // placement as the receiver/logger lookups above), so a bad categoryId
    // fails cleanly with 404 rather than a raw FK-constraint error mid-write.
    // `description` is derived from the category's own name — never
    // independently supplied by the caller — so this column and `categoryId`
    // can never disagree.
    const categoryIds = [...new Set(expenseItems.map((e) => e.categoryId))];
    const categories = categoryIds.length
      ? await this.prisma.expenseCategory.findMany({ where: { id: { in: categoryIds } } })
      : [];
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    for (const item of expenseItems) {
      if (!categoryById.has(item.categoryId)) {
        throw new NotFoundException({
          error: `Expense category not found: ${item.categoryId}`,
          code: 'NOT_FOUND',
        });
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const handover = await tx.cashHandover.create({
        data: {
          date:         new Date(dto.date),
          receiverName: receiver.name,
          receiverId:   receiver.id,
          expectedAmt:  expected.toFixed(2),
          handedAmt:    handed.toFixed(2),
          difference:   diff.toFixed(2),
          notes:        dto.notes ?? null,
          loggedById:   logger.id,
          ...(expenseItems.length > 0 ? {
            expenses: {
              create: expenseItems.map(e => ({
                description: categoryById.get(e.categoryId)!.name,
                amount: new Decimal(e.amount).toFixed(2),
                categoryId: e.categoryId,
              })),
            },
          } : {}),
        },
        include: {
          loggedBy: { select: { id: true, name: true } },
          receiver: { select: { id: true, name: true } },
          expenses: true,
        },
      });

      // Debit the receiver's account by the FULL settled amount — physical
      // handover + expenses kept from collection (see comment above) —
      // delegates to LedgerWriteService, moved in PR 1.
      await this.ledgerWriteService.debitAccount(tx, receiver.id, settledDec, handover.id, new Date(dto.date));

      return handover;
    });
  }

  // ===========================================================================
  // Expenses page — Employee → Category → Occurrence hierarchy (forensic
  // audit, 2026-08-31: "Expenses + Cash Handover expense selection redesign").
  //
  // CashHandoverExpense (via its parent CashHandover.receiverId/receiverName)
  // is the single authoritative "expense occurrence" record — these three
  // methods only READ and aggregate it; no new record is ever created here,
  // and viewing a summary/detail can never affect the ledger settlement
  // computed in create() above. "Employee" = CashHandover.receiver (a User —
  // whoever received cash and had these amounts deducted before handing the
  // rest over), not Worker (a different, wages-only concept — see Worker vs.
  // User in the audit's final report).
  //
  // Every date-filtered read here shares one private helper (`expenseRows`)
  // rather than three duplicated Prisma queries — filtered by the PARENT
  // CashHandover.date (CashHandoverExpense has no date column of its own,
  // same as reports.service.ts's existing P&L aggregate). Never paginated/
  // capped: an aggregation must sum the COMPLETE matching set, not a page of
  // it (the exact anti-pattern this redesign replaces — see
  // useAllCashHandoverExpenses()'s doc comment, frontend).
  // ===========================================================================

  private async expenseRows(dateFrom?: string, dateTo?: string) {
    const dateFilter = (dateFrom || dateTo)
      ? {
          ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
          ...(dateTo ? { lte: new Date(dateTo) } : {}),
        }
      : undefined;
    return this.prisma.cashHandoverExpense.findMany({
      where: dateFilter ? { cashHandover: { date: dateFilter } } : {},
      include: {
        cashHandover: {
          select: {
            id: true, date: true, receiverId: true, receiverName: true,
            // expectedAmt/handedAmt: added for getBusinessExpenses()'s
            // reconciliation context (business-model audit, 2026-09-04) —
            // read-only, not used by the three grouping methods below.
            expectedAmt: true, handedAmt: true,
            receiver: { select: { id: true, name: true } },
          },
        },
        category: { select: { id: true, name: true } },
      },
      orderBy: { cashHandover: { date: 'desc' } },
    });
  }

  /**
   * GET /cash-handovers/expenses/summary — one row per employee who has
   * logged at least one cash-handover expense in range, total amount only.
   * Powers the Expenses page's PRIMARY view. Employees with zero expenses in
   * range are never listed here (nothing to summarize) — see
   * getEmployeeExpenses() for a specific employee's zero-expense case.
   */
  async getExpensesSummary(dateFrom?: string, dateTo?: string) {
    const rows = await this.expenseRows(dateFrom, dateTo);

    const byEmployee = new Map<string, { employeeId: string | null; employeeName: string; total: Decimal }>();
    for (const r of rows) {
      // Legacy handovers can have receiverId=null (see CashHandover.receiverId
      // doc comment) — grouped by receiverName instead so they still appear
      // as their own person rather than being silently dropped or merged.
      const key = r.cashHandover.receiverId ?? `name:${r.cashHandover.receiverName}`;
      const name = r.cashHandover.receiver?.name ?? r.cashHandover.receiverName;
      const entry = byEmployee.get(key) ?? { employeeId: r.cashHandover.receiverId, employeeName: name, total: new Decimal(0) };
      entry.total = entry.total.plus(r.amount.toString());
      byEmployee.set(key, entry);
    }

    return [...byEmployee.values()]
      .map((e) => ({ employeeId: e.employeeId, employeeName: e.employeeName, totalExpenses: e.total.toFixed(2) }))
      .sort((a, b) => parseFloat(b.totalExpenses) - parseFloat(a.totalExpenses));
  }

  /**
   * GET /cash-handovers/expenses/employee/:employeeId — one employee's total
   * plus a category breakdown. `employeeId` is a User.id (see class doc
   * comment above) — validated to exist so an unknown id 404s cleanly rather
   * than silently returning an empty summary.
   */
  async getEmployeeExpenses(employeeId: string, dateFrom?: string, dateTo?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: employeeId }, select: { id: true, name: true } });
    if (!user) throw new NotFoundException({ error: 'Employee not found', code: 'NOT_FOUND' });

    const rows = (await this.expenseRows(dateFrom, dateTo))
      .filter((r) => r.cashHandover.receiverId === employeeId);

    const byCategory = new Map<string, { categoryId: string | null; categoryName: string; total: Decimal }>();
    for (const r of rows) {
      // A pre-migration/legacy row can have categoryId=null (see
      // CashHandoverExpense.categoryId doc comment) — grouped by its own
      // description instead so it still shows up as its own bucket rather
      // than being dropped.
      const key = r.categoryId ?? `desc:${r.description}`;
      const name = r.category?.name ?? r.description;
      const entry = byCategory.get(key) ?? { categoryId: r.categoryId, categoryName: name, total: new Decimal(0) };
      entry.total = entry.total.plus(r.amount.toString());
      byCategory.set(key, entry);
    }

    const categories = [...byCategory.values()]
      .map((c) => ({ categoryId: c.categoryId, categoryName: c.categoryName, total: c.total.toFixed(2) }))
      .sort((a, b) => parseFloat(b.total) - parseFloat(a.total));
    const totalExpenses = rows.reduce((s, r) => s.plus(r.amount.toString()), new Decimal(0)).toFixed(2);

    return { employeeId: user.id, employeeName: user.name, totalExpenses, categories };
  }

  /**
   * GET /cash-handovers/expenses/employee/:employeeId/category/:categoryId —
   * every individual expense occurrence for one employee in one category
   * (the drill-down from getEmployeeExpenses()'s category row). Read-only —
   * see this section's class doc comment.
   */
  async getEmployeeCategoryExpenses(employeeId: string, categoryId: string, dateFrom?: string, dateTo?: string) {
    const [user, category] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: employeeId }, select: { id: true, name: true } }),
      this.prisma.expenseCategory.findUnique({ where: { id: categoryId }, select: { id: true, name: true } }),
    ]);
    if (!user) throw new NotFoundException({ error: 'Employee not found', code: 'NOT_FOUND' });
    if (!category) throw new NotFoundException({ error: 'Expense category not found', code: 'NOT_FOUND' });

    const rows = (await this.expenseRows(dateFrom, dateTo))
      .filter((r) => r.cashHandover.receiverId === employeeId && r.categoryId === categoryId);

    const occurrences = rows.map((r) => ({
      id: r.id,
      date: r.cashHandover.date,
      amount: new Decimal(r.amount.toString()).toFixed(2),
      cashHandoverId: r.cashHandoverId,
    }));
    const total = rows.reduce((s, r) => s.plus(r.amount.toString()), new Decimal(0)).toFixed(2);

    return {
      employeeId: user.id, employeeName: user.name,
      categoryId: category.id, categoryName: category.name,
      total, occurrences,
    };
  }

  /**
   * GET /cash-handovers/expenses — every cash-handover-sourced BUSINESS
   * expense in range, as a flat list (Business Expenses page, business-model
   * audit 2026-09-04: "a Cash Handover is NOT an employee expense — the
   * employee is only the cash holder/settlement reference, the expense
   * belongs to the business"). Reads the exact same CashHandoverExpense rows
   * as getExpensesSummary()/getEmployeeExpenses() above (see this section's
   * class doc comment: single authoritative occurrence, read-only, never a
   * second accounting record) — just reshaped flat instead of grouped by
   * receiver, so the frontend can render one combined business-expense list
   * alongside GeneralExpense rows without a client-side fan-out.
   *
   * cashHolderId/cashHolderName label WHOSE custody the expense was deducted
   * from — never presented as expense ownership. handoverExpectedAmt/
   * handoverHandedAmt/handoverExpensesTotal (the SUM of every expense on that
   * same handover, not just this row) are included so a detail view can show
   * "cash collected/held = expectedAmt + handoverExpensesTotal" without a
   * second request — all three are existing CashHandover fields/derivations,
   * nothing invented.
   */
  async getBusinessExpenses(dateFrom?: string, dateTo?: string) {
    const rows = await this.expenseRows(dateFrom, dateTo);

    const handoverExpenseTotals = new Map<string, Decimal>();
    for (const r of rows) {
      const prev = handoverExpenseTotals.get(r.cashHandoverId) ?? new Decimal(0);
      handoverExpenseTotals.set(r.cashHandoverId, prev.plus(r.amount.toString()));
    }

    return rows.map((r) => ({
      id: r.id,
      date: r.cashHandover.date,
      categoryId: r.categoryId,
      categoryName: r.category?.name ?? r.description,
      description: r.description,
      amount: new Decimal(r.amount.toString()).toFixed(2),
      cashHandoverId: r.cashHandoverId,
      cashHolderId: r.cashHandover.receiverId,
      cashHolderName: r.cashHandover.receiver?.name ?? r.cashHandover.receiverName,
      handoverExpectedAmt: new Decimal(r.cashHandover.expectedAmt.toString()).toFixed(2),
      handoverHandedAmt: new Decimal(r.cashHandover.handedAmt.toString()).toFixed(2),
      handoverExpensesTotal: handoverExpenseTotals.get(r.cashHandoverId)!.toFixed(2),
    }));
  }
}
