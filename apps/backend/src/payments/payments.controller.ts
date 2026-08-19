import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ParseLimitPipe, ParsePagePipe } from '../common/pipes/pagination.pipes';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClerkUser } from '../auth/clerk.strategy';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @ApiOperation({ summary: 'List payments (paginated)' })
  @ApiResponse({ status: 200, description: 'Paginated payment list' })
  @Get()
  @Roles('owner', 'accountant', 'sales_rep')
  findAll(
    @Query('page', new ParsePagePipe()) page: number,
    @Query('limit', new ParseLimitPipe(20)) limit: number,
    @Query('clientId') clientId?: string,
    @Query('invoiceId') invoiceId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    return this.paymentsService.findAll(page, limit, clientId, invoiceId, dateFrom, dateTo, sortBy, sortOrder);
  }

  @ApiOperation({ summary: 'Get a payment by ID' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  @Get(':id')
  @Roles('owner', 'accountant', 'sales_rep')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.paymentsService.findOne(id);
  }

  @ApiOperation({ summary: 'Record a new payment' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 400, description: 'INVALID_STATE or CONSTRAINT_VIOLATION' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  @Post()
  @Roles('owner', 'accountant', 'sales_rep')
  create(
    @Body() dto: CreatePaymentDto,
    @CurrentUser() user: ClerkUser,
  ) {
    return this.paymentsService.create(dto, user.userId);
  }
}
