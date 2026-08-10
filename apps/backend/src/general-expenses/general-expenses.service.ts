import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGeneralExpenseDto } from './dto/create-general-expense.dto';

/**
 * "Option B" recurrence semantics — the single source of truth for how a
 * GeneralExpense row is scoped to a date range, shared by every caller
 * (Expenses page via findAll() below, and the Net Profit P&L calculation in
 * ReportsService.getProfitLoss()) so there is exactly one recurrence
 * implementation, never a second divergent one.
 *
 * Recurring expenses (isRecurring=true) repeat every period FROM their
 * recorded `date` FORWARD — a recurring rent line entered in August must
 * still appear when the caller asks for a later window (e.g. October), but
 * must NOT appear for any window entirely before August (there's no
 * end-date concept yet, so "forward" is unbounded once started). One-time
 * (isRecurring=false) rows are narrowed to exactly the requested range.
 *
 * @param dateFilter - already-resolved `{ gte?, lte? }` Date bounds (NOT raw
 * strings) — callers resolve their own date-string parsing / default-lookback
 * behavior first (e.g. ReportsService's `buildDateFilterWithDefault`) and
 * pass the resulting Dates in here, so this function never re-derives or
 * silently diverges from a caller's own default-range policy.
 */
export function buildGeneralExpenseWhere(
  dateFilter?: { gte?: Date; lte?: Date },
): Prisma.GeneralExpenseWhereInput {
  if (!dateFilter || (!dateFilter.gte && !dateFilter.lte)) return {};

  const oneTimeDateFilter: Prisma.DateTimeFilter = {
    ...(dateFilter.gte ? { gte: dateFilter.gte } : {}),
    ...(dateFilter.lte ? { lte: dateFilter.lte } : {}),
  };

  return {
    OR: [
      // Recurring: only an upper bound — must have started on/before the end
      // of the requested window. No lower bound, so it keeps showing in
      // every later period too (no end-date field exists yet).
      { isRecurring: true, ...(dateFilter.lte ? { date: { lte: dateFilter.lte } } : {}) },
      { isRecurring: false, date: oneTimeDateFilter },
    ],
  };
}

@Injectable()
export class GeneralExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param dateFrom - Optional inclusive lower bound on `date` (one-time rows only)
   * @param dateTo   - Optional inclusive upper bound on `date`
   *
   * Date-scoping is "Option B" recurrence — see {@link buildGeneralExpenseWhere}.
   */
  async findAll(page: number, limit: number, dateFrom?: string, dateTo?: string) {
    const skip = (page - 1) * limit;

    const where = buildGeneralExpenseWhere(
      dateFrom || dateTo
        ? {
            ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
            ...(dateTo ? { lte: new Date(dateTo) } : {}),
          }
        : undefined,
    );

    const [data, total] = await this.prisma.$transaction([
      this.prisma.generalExpense.findMany({
        where,
        skip,
        take: limit,
        orderBy: { date: 'desc' },
      }),
      this.prisma.generalExpense.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const expense = await this.prisma.generalExpense.findUnique({ where: { id } });
    if (!expense) throw new NotFoundException({ error: 'General expense not found', code: 'NOT_FOUND' });
    return expense;
  }

  async create(dto: CreateGeneralExpenseDto, clerkUserId: string) {
    const user = await this.prisma.user.findUnique({ where: { clerkId: clerkUserId } });
    if (!user) throw new UnauthorizedException({ error: 'User not found', code: 'UNAUTHORIZED' });

    return this.prisma.generalExpense.create({
      data: {
        description: dto.description,
        amount: dto.amount,
        isRecurring: dto.isRecurring ?? false,
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        date: dto.date ? new Date(dto.date) : new Date(),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        addedById: user.id,
      },
    });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.generalExpense.delete({ where: { id } });
  }
}
