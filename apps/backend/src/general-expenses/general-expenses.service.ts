import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGeneralExpenseDto } from './dto/create-general-expense.dto';

@Injectable()
export class GeneralExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.generalExpense.findMany({
        skip,
        take: limit,
        orderBy: { date: 'desc' },
      }),
      this.prisma.generalExpense.count(),
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
