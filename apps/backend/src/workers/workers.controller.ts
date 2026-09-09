import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ParseLimitPipe, ParsePagePipe } from '../common/pipes/pagination.pipes';
import { WorkersService } from './workers.service';
import { CreateWorkerDto } from './dto/create-worker.dto';
import { UpdateWorkerDto } from './dto/update-worker.dto';
import { SetRatesDto } from './dto/set-rates.dto';
import { CreateWorkerPaymentDto } from './dto/create-worker-payment.dto';
import { CreateWorkerEarningDto } from './dto/create-worker-earning.dto';
import { UpdateWorkerEarningDto } from './dto/update-worker-earning.dto';
import { LogDailyWageDto } from './dto/log-daily-wage.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClerkUser } from '../auth/clerk.strategy';

@ApiTags('workers')
@ApiBearerAuth()
@Controller('workers')
@Roles('owner')
export class WorkersController {
  constructor(private readonly workersService: WorkersService) {}

  @ApiOperation({ summary: 'List workers (paginated)' })
  @ApiResponse({ status: 200, description: 'Worker list with computed totalOwed' })
  @Get()
  findAll(
    @Query('page', new ParsePagePipe()) page: number,
    @Query('limit', new ParseLimitPipe(20)) limit: number,
  ) {
    return this.workersService.findAll(page, limit);
  }

  @ApiOperation({ summary: 'Get a worker by ID' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.workersService.findOne(id);
  }

  @ApiOperation({ summary: 'Create a new worker' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 422 })
  @Post()
  create(@Body() dto: CreateWorkerDto) {
    return this.workersService.create(dto);
  }

  @ApiOperation({ summary: 'Update a worker (name, phone, notes)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkerDto,
  ) {
    return this.workersService.update(id, dto);
  }

  @ApiOperation({ summary: 'Delete a worker' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.workersService.remove(id);
  }

  @ApiOperation({ summary: 'Set bag-type rates for a worker (full replacement)' })
  @ApiResponse({ status: 200, description: 'Full rate array replacement' })
  @Patch(':id/rates')
  setRates(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetRatesDto,
  ) {
    return this.workersService.setRates(id, dto);
  }

  @ApiOperation({ summary: 'List payments for a worker (optionally filtered by date range)' })
  @ApiResponse({ status: 200 })
  @Get(':id/payments')
  listPayments(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page', new ParsePagePipe()) page: number,
    @Query('limit', new ParseLimitPipe(20)) limit: number,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.workersService.listPayments(id, page, limit, dateFrom, dateTo);
  }

  @ApiOperation({ summary: 'Add a payment to a worker' })
  @ApiResponse({ status: 201, description: 'Payment created, totalPaid incremented' })
  @Post(':id/payments')
  addPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateWorkerPaymentDto,
  ) {
    return this.workersService.addPayment(id, dto);
  }

  @ApiOperation({ summary: 'Get a single worker payment' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  @Get(':id/payments/:paymentId')
  getPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
  ) {
    return this.workersService.getPayment(id, paymentId);
  }

  @ApiOperation({ summary: 'List earnings entries for a worker' })
  @ApiResponse({ status: 200 })
  @Get(':id/earnings')
  listEarnings(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page', new ParsePagePipe()) page: number,
    @Query('limit', new ParseLimitPipe(20)) limit: number,
  ) {
    return this.workersService.listEarnings(id, page, limit);
  }

  @ApiOperation({ summary: 'Log an earnings entry for a worker (daily wage, bonus, deduction, etc.)' })
  @ApiResponse({ status: 201 })
  @Post(':id/earnings')
  addEarning(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateWorkerEarningDto,
    @CurrentUser() user: ClerkUser,
  ) {
    return this.workersService.createEarning(id, dto, user.userId);
  }

  @ApiOperation({ summary: 'Get a single earnings entry' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  @Get(':id/earnings/:earningId')
  getEarning(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('earningId', ParseUUIDPipe) earningId: string,
  ) {
    return this.workersService.getEarning(id, earningId);
  }

  @ApiOperation({ summary: 'Edit an earnings entry — only within the short edit window after creation' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403, description: 'Edit window expired — log a correction entry instead' })
  @ApiResponse({ status: 404 })
  @Patch(':id/earnings/:earningId')
  updateEarning(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('earningId', ParseUUIDPipe) earningId: string,
    @Body() dto: UpdateWorkerEarningDto,
  ) {
    return this.workersService.updateEarning(id, earningId, dto);
  }

  @ApiOperation({ summary: '"Add daily wage" — records today\'s daily wage using the configured Settings amount' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 400, description: 'Daily wage amount not configured in Settings' })
  @ApiResponse({ status: 404 })
  @ApiResponse({ status: 409, description: 'Daily wage already recorded for this date' })
  @Post(':id/daily-wage')
  addDailyWage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LogDailyWageDto,
    @CurrentUser() user: ClerkUser,
  ) {
    return this.workersService.logDailyWage(id, dto, user.userId);
  }

  @ApiOperation({ summary: 'Statement of Account — chronological earning/payment ledger with running balance' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  @Get(':id/statement')
  getStatement(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.workersService.getStatement(id, dateFrom, dateTo);
  }

  @ApiOperation({ summary: 'Employee performance analytics — bags packed, bag-type breakdown, working days, daily performance, packing history (owner-only, same as the rest of this controller)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  @Get(':id/performance')
  getPerformance(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.workersService.getPerformance(id, dateFrom, dateTo);
  }
}
