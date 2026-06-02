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
import { IsDateString, IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID } from 'class-validator';
import { Currency, PaymentMethod } from '@prisma/client';
import { ParseLimitPipe, ParsePagePipe } from '../common/pipes/pagination.pipes';
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClerkUser } from '../auth/clerk.strategy';

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

  @ApiOperation({ summary: 'List all suppliers' })
  @ApiResponse({ status: 200, description: 'Paginated list of suppliers' })
  @Get()
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
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.suppliersService.findOne(id);
  }

  @ApiOperation({ summary: 'Create a new supplier' })
  @ApiResponse({ status: 201, description: 'Supplier created' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  @Post()
  @Roles('owner', 'accountant')
  create(@Body() dto: CreateSupplierDto) {
    return this.suppliersService.create(dto);
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
