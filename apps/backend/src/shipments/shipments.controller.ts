import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ShipmentStatus } from '@prisma/client';
import { ParseLimitPipe, ParsePagePipe } from '../common/pipes/pagination.pipes';
import { ShipmentsService } from './shipments.service';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { ConfirmDeliveryDto } from './dto/confirm-delivery.dto';
import { LogReturnDto } from './dto/log-return.dto';
import { UpdateActualWeightDto } from './dto/update-actual-weight.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClerkUser } from '../auth/clerk.strategy';

@ApiTags('shipments')
@ApiBearerAuth()
@Controller('shipments')
export class ShipmentsController {
  constructor(private readonly shipmentsService: ShipmentsService) {}

  @ApiOperation({ summary: 'List all shipments (paginated)' })
  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 400, description: 'Bad request / constraint violation' })
  @Get()
  @Roles('owner', 'sales_rep', 'driver')
  findAll(
    @Query('page', new ParsePagePipe()) page: number,
    @Query('limit', new ParseLimitPipe(20)) limit: number,
    @Query('orderId') orderId?: string,
    @Query('status') status?: ShipmentStatus,
    @Query('tripId') tripId?: string,
  ) {
    return this.shipmentsService.findAll(page, limit, orderId, status, tripId);
  }

  @ApiOperation({ summary: 'Get a shipment by ID' })
  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Get(':id')
  @Roles('owner', 'sales_rep', 'driver')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.shipmentsService.findOne(id);
  }

  @ApiOperation({ summary: 'Create a shipment (checks packed stock before writing)' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 400, description: 'Bad request / constraint violation' })
  @Post()
  @Roles('owner', 'sales_rep')
  create(
    @Body() dto: CreateShipmentDto,
    @CurrentUser() user: ClerkUser,
  ) {
    return this.shipmentsService.createShipment(dto, user.userId);
  }

  @ApiOperation({ summary: 'Update shipment (general patch)' })
  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 400, description: 'Bad request / constraint violation' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Patch(':id')
  @Roles('owner', 'sales_rep', 'driver')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateActualWeightDto,
    @CurrentUser() user: ClerkUser,
  ) {
    return this.shipmentsService.updateActualWeight(id, dto, user);
  }

  @ApiOperation({ summary: 'Update actual weight of a shipment' })
  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 400, description: 'Bad request / constraint violation' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Patch(':id/actual-weight')
  @Roles('driver', 'owner')
  updateActualWeight(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateActualWeightDto,
    @CurrentUser() user: ClerkUser,
  ) {
    return this.shipmentsService.updateActualWeight(id, dto, user);
  }

  @ApiOperation({ summary: 'Confirm delivery — drains packed stock FIFO (atomic)' })
  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 400, description: 'Bad request / constraint violation' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Post(':id/confirm-delivery')
  @Roles('driver', 'owner')
  confirmDelivery(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmDeliveryDto,
    @CurrentUser() user: ClerkUser,
  ) {
    return this.shipmentsService.confirmDelivery(id, dto, user);
  }

  @ApiOperation({ summary: 'Log a return for a shipment (atomic)' })
  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 400, description: 'Bad request / constraint violation' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Post(':id/return')
  @Roles('driver', 'owner')
  logReturn(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LogReturnDto,
    @CurrentUser() user: ClerkUser,
  ) {
    return this.shipmentsService.logReturn(id, dto, user);
  }

  @ApiOperation({ summary: 'Cancel a pending shipment — releases its packed-stock reservation (atomic)' })
  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 400, description: 'Bad request / invalid transition' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Post(':id/cancel')
  @Roles('owner', 'sales_rep')
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.shipmentsService.cancelShipment(id);
  }

  @ApiOperation({ summary: 'Get a delivery receipt for a shipment' })
  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Get(':id/receipt')
  @Roles('driver', 'owner', 'sales_rep')
  getReceipt(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: ClerkUser,
  ) {
    return this.shipmentsService.getReceipt(id, user);
  }
}
