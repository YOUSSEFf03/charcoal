import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ExpenseCategoriesService } from './expense-categories.service';
import { CreateExpenseCategoryDto } from './dto/create-expense-category.dto';
import { Roles } from '../auth/roles.decorator';

// Same role set as CashHandoversController — categories are only ever
// selected/created from the Cash Handover expense entry flow, which is
// already owner/accountant-only. See that controller's class-level @Roles
// doc comment for the authorization-model audit this preserves.
@ApiTags('expense-categories')
@ApiBearerAuth()
@Controller('expense-categories')
@Roles('owner', 'accountant')
export class ExpenseCategoriesController {
  constructor(private readonly service: ExpenseCategoriesService) {}

  @ApiOperation({ summary: 'List all expense categories (for the Cash Handover expense dropdown)' })
  @ApiResponse({ status: 200 })
  @Get()
  findAll() {
    return this.service.findAll();
  }

  @ApiOperation({ summary: 'Create a new expense category, or return the existing one if the name already matches (case-insensitive) — "+ Add new expense"' })
  @ApiResponse({ status: 201, description: 'Created or existing category' })
  @Post()
  create(@Body() dto: CreateExpenseCategoryDto) {
    return this.service.findOrCreate(dto.name);
  }
}
