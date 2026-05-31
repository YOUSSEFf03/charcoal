import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { WorkersService } from './workers.service';
import { CreateWorkerDto } from './dto/create-worker.dto';
import { UpdateWorkerDto } from './dto/update-worker.dto';
import { SetRatesDto } from './dto/set-rates.dto';
import { CreateWorkerPaymentDto } from './dto/create-worker-payment.dto';
import { Roles } from '../auth/roles.decorator';

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
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
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

  @ApiOperation({ summary: 'List payments for a worker' })
  @ApiResponse({ status: 200 })
  @Get(':id/payments')
  listPayments(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.workersService.listPayments(id, page, limit);
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
}
