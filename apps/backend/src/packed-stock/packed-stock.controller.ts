import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PackedStockService } from './packed-stock.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClerkUser } from '../auth/clerk.strategy';

@ApiTags('packed-stock')
@ApiBearerAuth()
@Controller('packed-stock')
export class PackedStockController {
  constructor(private readonly packedStockService: PackedStockService) {}

  @ApiOperation({ summary: 'Packed stock totals per bag type' })
  @ApiResponse({ status: 200, description: 'Success' })
  @Get('summary')
  findSummary() {
    return this.packedStockService.findSummary();
  }

  @ApiOperation({ summary: 'List packed stock with bagType and lot' })
  @ApiResponse({ status: 200, description: 'Success' })
  @Get()
  findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('lotId') lotId?: string,
    @Query('bagTypeId') bagTypeId?: string,
    @CurrentUser() user?: ClerkUser,
  ) {
    return this.packedStockService.findAll(page, limit, lotId, bagTypeId, user?.role);
  }
}
