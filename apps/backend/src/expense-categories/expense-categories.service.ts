import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Reusable expense category/type (e.g. "Fuel", "Food") — selected from a
 * dropdown when logging a Cash Handover expense, or created on the fly via
 * "+ Add new expense". See ExpenseCategory's schema.prisma doc comment
 * (forensic audit, 2026-08-31 — "Expenses + Cash Handover expense selection
 * redesign") for why this model exists instead of continuing to store
 * CashHandoverExpense.description as ungoverned free text.
 */
@Injectable()
export class ExpenseCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.expenseCategory.findMany({ orderBy: { name: 'asc' } });
  }

  /**
   * Find-or-create, case/whitespace-insensitive — "+ Add new expense" must
   * never create a duplicate row for a name that already exists under
   * different casing (the exact "Fuel"/"fuel"/"FUEL" duplication this model
   * exists to prevent — see schema.prisma). Idempotent: selecting an
   * existing category by typing its name again returns that SAME category,
   * never a second row.
   */
  async findOrCreate(name: string) {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new BadRequestException({ error: 'Category name is required', code: 'VALIDATION_ERROR' });
    }

    const existing = await this.prisma.expenseCategory.findFirst({
      where: { name: { equals: trimmed, mode: 'insensitive' } },
    });
    if (existing) return existing;

    try {
      return await this.prisma.expenseCategory.create({ data: { name: trimmed } });
    } catch (e) {
      // Expected race: two near-simultaneous "+ Add new expense" calls for
      // the same (case-insensitive) name — the DB's unique index on `name`
      // is the real guarantee here; only one create() wins, the other hits
      // P2002. Recover by returning the winner instead of surfacing a raw
      // constraint-violation error, mirroring the same P2002-recovery
      // pattern already used elsewhere in this codebase (e.g.
      // WalkInSalesService.create()'s idempotency-key race recovery).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const winner = await this.prisma.expenseCategory.findFirst({
          where: { name: { equals: trimmed, mode: 'insensitive' } },
        });
        if (winner) return winner;
      }
      throw e;
    }
  }
}
