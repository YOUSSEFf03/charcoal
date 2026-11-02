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
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID } from 'class-validator';
import { Currency, PaymentMethod } from '@prisma/client';
import { ParseLimitPipe, ParsePagePipe } from '../common/pipes/pagination.pipes';
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClerkUser } from '../auth/clerk.strategy';
import { SetOpeningBalanceDto } from '../common/dto/set-opening-balance.dto';
import { assertCanSetOpeningBalance } from '../common/utils/opening-balance';

class CreateSupplierPaymentDto {
  @IsNumberString() @IsNotEmpty() amount: string;
  @IsEnum(Currency) currency: Currency;
  @IsEnum(PaymentMethod) method: PaymentMethod;
  @IsDateString() date: string;
  @IsOptional() @IsUUID() containerId?: string;
  @IsOptional() @IsString() notes?: string;
}

@ApiTags('suppliers')
@ApiBearerAuth()
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  // Supplier cost/pricing data (costPerKg, totalSpentUsd, avgPricePerKg,
  // outstandingUsd) is sensitive the same way it's already treated everywhere
  // else in this codebase (see reports.controller.ts's supplier-cost redaction
  // for sales_rep) — restricted to owner/accountant, matching every other
  // endpoint in this controller, rather than left open to every authenticated
  // role (the previous, unintentional default when no @Roles() is present).
  @ApiOperation({ summary: 'List all suppliers' })
  @ApiResponse({ status: 200, description: 'Paginated list of suppliers' })
  @Get()
  @Roles('owner', 'accountant')
  findAll(
    @Query('page', new ParsePagePipe()) page: number,
    @Query('limit', new ParseLimitPipe(20)) limit: number,
    @Query('search') search?: string,
  ) {
    return this.suppliersService.findAll(page, limit, search);
  }

  @ApiOperation({ summary: 'Get a supplier by ID' })
  @ApiResponse({ status: 200, description: 'Supplier with purchase history' })
  @ApiResponse({ status: 404, description: 'Supplier not found' })
  @Get(':id')
  @Roles('owner', 'accountant')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.suppliersService.findOne(id);
  }

  @ApiOperation({ summary: 'Create a new supplier' })
  @ApiResponse({ status: 201, description: 'Supplier created' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  @Post()
  @Roles('owner', 'accountant')
  create(@Body() dto: CreateSupplierDto, @CurrentUser() user: ClerkUser) {
    if (dto.openingBalance) assertCanSetOpeningBalance(user.role);
    return this.suppliersService.create(dto, user.userId);
  }

  @ApiOperation({ summary: 'Update a supplier' })
  @ApiResponse({ status: 200, description: 'Supplier updated' })
  @ApiResponse({ status: 404, description: 'Supplier not found' })
  @Patch(':id')
  @Roles('owner', 'accountant')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.suppliersService.update(id, dto);
  }

  @ApiOperation({ summary: 'List payments made to a supplier' })
  @ApiResponse({ status: 200, description: 'Paginated payments' })
  @Get(':id/payments')
  @Roles('owner', 'accountant')
  findPayments(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page', new ParsePagePipe()) page: number,
    @Query('limit', new ParseLimitPipe(20)) limit: number,
  ) {
    return this.suppliersService.findPayments(id, page, limit);
  }

  @ApiOperation({ summary: 'Record a payment to a supplier' })
  @ApiResponse({ status: 201, description: 'Payment recorded' })
  @Post(':id/payments')
  @Roles('owner', 'accountant')
  createPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSupplierPaymentDto,
    @CurrentUser() user: ClerkUser,
  ) {
    return this.suppliersService.createPayment(id, dto, user.userId);
  }

  // ── Opening balance (go-live carry-forward, always USD) ───────────────────
  @ApiOperation({ summary: 'Get a supplier\'s opening balance (null if none)' })
  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 404, description: 'Supplier not found' })
  @Get(':id/opening-balance')
  @Roles('owner', 'accountant')
  getOpeningBalance(@Param('id', ParseUUIDPipe) id: string) {
    return this.suppliersService.getOpeningBalance(id);
  }

  @ApiOperation({ summary: 'Set or replace a supplier\'s opening balance (owner only)' })
  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 400, description: 'Validation error / zero amount' })
  @ApiResponse({ status: 404, description: 'Supplier not found' })
  @Put(':id/opening-balance')
  @Roles('owner')
  setOpeningBalance(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetOpeningBalanceDto,
    @CurrentUser() user: ClerkUser,
  ) {
    return this.suppliersService.setOpeningBalance(id, dto, user.userId);
  }

  @ApiOperation({ summary: 'Remove a supplier\'s opening balance (owner only)' })
  @ApiResponse({ status: 204, description: 'Removed' })
  @ApiResponse({ status: 404, description: 'Supplier not found' })
  @Delete(':id/opening-balance')
  @Roles('owner')
  @HttpCode(204)
  clearOpeningBalance(@Param('id', ParseUUIDPipe) id: string) {
    return this.suppliersService.clearOpeningBalance(id);
  }

  @ApiOperation({ summary: 'Delete a supplier' })
  @ApiResponse({ status: 204, description: 'Supplier deleted' })
  @ApiResponse({ status: 409, description: 'Supplier has linked records' })
  @ApiResponse({ status: 404, description: 'Supplier not found' })
  @Delete(':id')
  @Roles('owner')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.suppliersService.remove(id);
  }
}
