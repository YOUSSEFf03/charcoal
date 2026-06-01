import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { ParseLimitPipe, ParsePagePipe } from '../common/pipes/pagination.pipes';
import { ReportsService } from './reports.service';
import { SubmitPhysicalCountDto } from './dto/physical-count.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClerkUser } from '../auth/clerk.strategy';

@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /**
   * P&L report — owner only (CONSTRAINT 11).
   * Returns revenue, COGS, bag cost, variance cost, delivery cost, and gross profit.
   */
  @ApiOperation({ summary: 'Profit & loss report (owner only)' })
  @ApiResponse({ status: 200, description: 'P&L breakdown with gross_profit' })
  @ApiResponse({ status: 403, description: 'Forbidden — non-owner roles' })
  @Roles('owner')
  @Get('profit-loss')
  getProfitLoss(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('charcoalType') charcoalType?: string,
    @Query('grade') grade?: string,
    @Query('clientId') clientId?: string,
  ) {
    return this.reportsService.getProfitLoss({ dateFrom, dateTo, charcoalType, grade, clientId });
  }

  /**
   * Stock value report — owner and accountant (CONSTRAINT 12: no costPerKg for other roles).
   */
  @ApiOperation({ summary: 'Current stock value per lot (owner/accountant)' })
  @ApiResponse({ status: 200, description: 'Lot values and totalValue' })
  @ApiResponse({ status: 403, description: 'Forbidden — sales_rep and worker' })
  @Roles('owner', 'accountant')
  @Get('stock-value')
  getStockValue(
    @Query('page', new ParsePagePipe()) page: number,
    @Query('limit', new ParseLimitPipe(50)) limit: number,
  ) {
    return this.reportsService.getStockValue(page, limit);
  }

  /**
   * Variance report — owner and accountant.
   */
  @ApiOperation({ summary: 'Packing variance report' })
  @ApiResponse({ status: 200, description: 'Per-session variance rows' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @Roles('owner', 'accountant')
  @Get('variance')
  getVariance(
    @Query('page', new ParsePagePipe()) page: number,
    @Query('limit', new ParseLimitPipe(50)) limit: number,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('workerId') workerId?: string,
  ) {
    return this.reportsService.getVariance({ dateFrom, dateTo, workerId, page, limit });
  }

  /**
   * Container costs report — owner and accountant.
   */
  @ApiOperation({ summary: 'Container cost breakdown with allInCostPerKg per product line' })
  @ApiResponse({ status: 200, description: 'Container cost report' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @Roles('owner', 'accountant')
  @Get('container-costs')
  getContainerCosts(
    @Query('page', new ParsePagePipe()) page: number,
    @Query('limit', new ParseLimitPipe(20)) limit: number,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('supplierId') supplierId?: string,
  ) {
    return this.reportsService.getContainerCosts({ dateFrom, dateTo, supplierId, page, limit });
  }

  /**
   * Client ledger — owner, accountant, sales_rep.
   * Returns chronological invoice/payment entries with running balance (CONSTRAINT 15).
   */
  @ApiOperation({ summary: 'Client ledger with running balance' })
  @ApiResponse({ status: 200, description: 'Ledger entries and computed balance' })
  @ApiResponse({ status: 403, description: 'Forbidden — worker and driver' })
  @ApiResponse({ status: 404, description: 'Client not found' })
  @Roles('owner', 'accountant', 'sales_rep')
  @Get('client-ledger/:clientId')
  getClientLedger(
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.reportsService.getClientLedger(clientId, { dateFrom, dateTo });
  }

  /**
   * Worker earnings report — owner only (CONSTRAINT 11).
   */
  @ApiOperation({ summary: 'Worker earnings breakdown (owner only)' })
  @ApiResponse({ status: 200, description: 'Sessions, payments, and computed totals' })
  @ApiResponse({ status: 403, description: 'Forbidden — non-owner roles' })
  @ApiResponse({ status: 404, description: 'Worker not found' })
  @Roles('owner')
  @Get('worker-earnings/:workerId')
  getWorkerEarnings(
    @Param('workerId', ParseUUIDPipe) workerId: string,
    @Query('page', new ParsePagePipe()) page: number,
    @Query('limit', new ParseLimitPipe(50)) limit: number,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.reportsService.getWorkerEarnings(workerId, { dateFrom, dateTo, page, limit });
  }

  /**
   * Physical count — get current system quantities (owner only).
   */
  @ApiOperation({ summary: 'Get current system stock quantities for physical count' })
  @ApiResponse({ status: 200, description: 'Packed stock grouped by bag type' })
  @ApiResponse({ status: 403, description: 'Forbidden — non-owner roles' })
  @Roles('owner')
  @Get('physical-count')
  getPhysicalCount() {
    return this.reportsService.getPhysicalCount();
  }

  /**
   * Submit physical count results — owner only (CONSTRAINT 13).
   * Creates StockAdjustment for each discrepancy with approvedById from request.user.
   */
  @ApiOperation({ summary: 'Submit physical count — creates adjustments for discrepancies' })
  @ApiResponse({ status: 200, description: 'adjustmentsCreated count and details' })
  @ApiResponse({ status: 403, description: 'Forbidden — non-owner roles' })
  @Roles('owner')
  @Post('physical-count')
  submitPhysicalCount(
    @Body() dto: SubmitPhysicalCountDto,
    @CurrentUser() user: ClerkUser,
  ) {
    return this.reportsService.submitPhysicalCount(dto, user.userId);
  }

  /**
   * AR summary — full-table SQL aggregates for the Invoices KPI cards.
   * Returns totalInvoiced, totalCollected, totalOutstanding, totalOverdue,
   * openInvoiceCount, overdueCount, oldestOverdueDays.
   * No rows are fetched into memory; safe at any invoice volume.
   */
  @ApiOperation({ summary: 'Accounts-receivable summary (full-table aggregates)' })
  @ApiResponse({ status: 200, description: 'AR totals computed over the full table in SQL' })
  @Roles('owner', 'accountant', 'sales_rep')
  @Get('ar-summary')
  getArSummary() {
    return this.reportsService.getArSummary();
  }

  /**
   * Unified activity feed — recent events from all major domains, sorted newest-first.
   * Sources: packing sessions, deliveries, payments, invoices, orders, fill jobs,
   *          containers, stock exits.
   */
  @ApiOperation({ summary: 'Unified activity feed — newest events from all domains' })
  @ApiResponse({ status: 200, description: 'Array of ActivityItem sorted by timestamp desc' })
  @Roles('owner', 'accountant', 'sales_rep')
  @Get('activity')
  getActivity(
    @Query('limit', new ParseLimitPipe(30)) limit: number,
  ) {
    return this.reportsService.getActivity(limit);
  }
}
