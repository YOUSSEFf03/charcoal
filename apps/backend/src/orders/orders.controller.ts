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
import { OrderStatus } from '@prisma/client';
import { ParseLimitPipe, ParsePagePipe } from '../common/pipes/pagination.pipes';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClerkUser } from '../auth/clerk.strategy';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @ApiOperation({ summary: 'List orders (paginated)' })
  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 400, description: 'Bad request / constraint violation' })
  @Get()
  @Roles('owner', 'sales_rep')
  findAll(
    @Query('page', new ParsePagePipe()) page: number,
    @Query('limit', new ParseLimitPipe(20)) limit: number,
    @Query('clientId') clientId?: string,
    @Query('status') status?: OrderStatus,
    @Query('search') search?: string,
  ) {
    return this.ordersService.findAll(page, limit, clientId, status, search);
  }

  @ApiOperation({ summary: 'Get an order by ID' })
  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Get(':id')
  @Roles('owner', 'sales_rep')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.findOne(id);
  }

  @ApiOperation({ summary: 'Create a new order' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 400, description: 'Bad request / constraint violation' })
  @Post()
  @Roles('owner', 'sales_rep')
  create(
    @Body() dto: CreateOrderDto,
    @CurrentUser() user: ClerkUser,
  ) {
    return this.ordersService.create(dto, user.userId);
  }

  @ApiOperation({ summary: 'Update an order' })
  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 400, description: 'Bad request / constraint violation' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Patch(':id')
  @Roles('owner', 'sales_rep')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderDto,
  ) {
    return this.ordersService.update(id, dto);
  }

  @ApiOperation({ summary: 'Mark order and all its shipments as delivered (owner override)' })
  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Patch(':id/mark-delivered')
  @Roles('owner')
  markDelivered(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.markDelivered(id);
  }

  @ApiOperation({ summary: 'Generate (or return existing) invoice for a delivered order' })
  @ApiResponse({ status: 201, description: 'Invoice created or existing invoice returned' })
  @ApiResponse({ status: 400, description: 'Order is not in delivered status' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @Post(':id/invoice')
  @Roles('owner', 'accountant')
  generateInvoice(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.createInvoiceForOrder(id);
  }

  @ApiOperation({ summary: 'Delete a draft order (no shipments)' })
  @ApiResponse({ status: 204, description: 'No content' })
  @ApiResponse({ status: 400, description: 'Bad request / constraint violation' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Delete(':id')
  @Roles('owner')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.remove(id);
  }
}
