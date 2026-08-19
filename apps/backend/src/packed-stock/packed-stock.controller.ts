import {
  Controller,
  Get,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ParseLimitPipe, ParsePagePipe } from '../common/pipes/pagination.pipes';
import { PackedStockService } from './packed-stock.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClerkUser } from '../auth/clerk.strategy';
import { Roles } from '../auth/roles.decorator';

@ApiTags('packed-stock')
@ApiBearerAuth()
@Controller('packed-stock')
export class PackedStockController {
  constructor(private readonly packedStockService: PackedStockService) {}

  // Matches stock-lots.controller.ts's role set exactly — driver deliberately
  // excluded. None of these three routes previously had any @Roles() at all,
  // so every authenticated role (including driver) could reach them.
  @ApiOperation({ summary: 'Packed stock totals per bag type' })
  @ApiResponse({ status: 200, description: 'Success' })
  @Get('summary')
  @Roles('owner', 'accountant', 'sales_rep', 'worker')
  findSummary() {
    return this.packedStockService.findSummary();
  }

  @ApiOperation({ summary: 'Server-side FIFO draw plan for one bag type (which PackedStock record(s), oldest first, to draw a sale of `quantity` bags from) — unbounded, not capped at any page size' })
  @ApiResponse({ status: 200, description: 'Success' })
  @Get('fifo-draw')
  @Roles('owner', 'accountant', 'sales_rep', 'worker')
  getFifoDraw(
    @Query('bagTypeId', ParseUUIDPipe) bagTypeId: string,
    @Query('quantity', ParseIntPipe) quantity: number,
  ) {
    return this.packedStockService.getFifoDraw(bagTypeId, quantity);
  }

  @ApiOperation({ summary: 'List packed stock with bagType and lot' })
  @ApiResponse({ status: 200, description: 'Success' })
  @Get()
  @Roles('owner', 'accountant', 'sales_rep', 'worker')
  findAll(
    @Query('page', new ParsePagePipe()) page: number,
    @Query('limit', new ParseLimitPipe(20)) limit: number,
    @Query('lotId') lotId?: string,
    @Query('bagTypeId') bagTypeId?: string,
    @CurrentUser() user?: ClerkUser,
  ) {
    return this.packedStockService.findAll(page, limit, lotId, bagTypeId, user?.role);
  }
}
