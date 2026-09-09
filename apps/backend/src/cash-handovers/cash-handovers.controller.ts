import { Body, Controller, Get, ParseUUIDPipe, Post, Query, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ParseLimitPipe, ParsePagePipe } from '../common/pipes/pagination.pipes';
import { CashHandoversService } from './cash-handovers.service';
import { CreateCashHandoverDto } from './dto/create-cash-handover.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClerkUser } from '../auth/clerk.strategy';

@ApiTags('cash-handovers')
@ApiBearerAuth()
@Controller('cash-handovers')
@Roles('owner', 'accountant')
export class CashHandoversController {
  constructor(private readonly service: CashHandoversService) {}

  @ApiOperation({ summary: 'List cash handovers' })
  @Get()
  findAll(
    @Query('page', new ParsePagePipe()) page: number,
    @Query('limit', new ParseLimitPipe(20)) limit: number,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('search') search?: string,
  ) {
    return this.service.findAll(page, limit, dateFrom, dateTo, search);
  }

  @ApiOperation({ summary: 'All users with balance > 0 — sorted by balance desc. Three aggregation queries.' })
  @Get('balances')
  getAllBalances() {
    return this.service.getAllBalances();
  }

  @ApiOperation({ summary: "Get a receiver's running cash balance by their user ID" })
  @Get('balance/user/:receiverId')
  getReceiverBalance(@Param('receiverId', ParseUUIDPipe) receiverId: string) {
    return this.service.getReceiverBalance(receiverId);
  }

  // ── Expenses page (forensic audit, 2026-08-31) ────────────────────────────
  // IMPORTANT: these three static-prefixed routes must be declared before any
  // future `@Get(':something')` on this controller, for the same reason
  // `GET /stock-exits/grouped` is declared before `GET /stock-exits/:id` —
  // otherwise Nest would try to parse "expenses" as a UUID path param.
  @ApiOperation({ summary: 'Flat list of every cash-handover-sourced business expense in range (Business Expenses page) — aggregated server-side, never paginated raw rows' })
  @Get('expenses')
  getBusinessExpenses(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.service.getBusinessExpenses(dateFrom, dateTo);
  }

  @ApiOperation({ summary: 'Cash-holder expense totals (per-employee breakdown) — aggregated server-side, never paginated raw rows' })
  @Get('expenses/summary')
  getExpensesSummary(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.service.getExpensesSummary(dateFrom, dateTo);
  }

  @ApiOperation({ summary: "One employee's expense total + category breakdown" })
  @Get('expenses/employee/:employeeId')
  getEmployeeExpenses(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.service.getEmployeeExpenses(employeeId, dateFrom, dateTo);
  }

  @ApiOperation({ summary: 'Every individual expense occurrence for one employee in one category' })
  @Get('expenses/employee/:employeeId/category/:categoryId')
  getEmployeeCategoryExpenses(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.service.getEmployeeCategoryExpenses(employeeId, categoryId, dateFrom, dateTo);
  }

  @ApiOperation({ summary: 'Log a cash handover' })
  @Post()
  create(
    @Body() dto: CreateCashHandoverDto,
    @CurrentUser() user: ClerkUser,
  ) {
    return this.service.create(dto, user.userId);
  }
}
