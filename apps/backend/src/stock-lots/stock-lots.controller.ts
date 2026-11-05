import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ParseLimitPipe, ParsePagePipe } from '../common/pipes/pagination.pipes';
import { StockLotsService } from './stock-lots.service';
import { CreateStockLotDto } from './dto/create-stock-lot.dto';
import { UpdateStockLotDto } from './dto/update-stock-lot.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClerkUser } from '../auth/clerk.strategy';

@ApiTags('stock-lots')
@ApiBearerAuth()
@Controller('stock-lots')
export class StockLotsController {
  constructor(private readonly stockLotsService: StockLotsService) {}

  @ApiOperation({ summary: 'List stock lots; costPerKg hidden from sales_rep and worker' })
  @ApiResponse({ status: 200, description: 'Success' })
  @Get()
  @Roles('owner', 'accountant', 'sales_rep', 'worker')
  findAll(
    @Query('page', new ParsePagePipe()) page: number,
    @Query('limit', new ParseLimitPipe(20)) limit: number,
    @Query('charcoalType') charcoalType?: string,
    @Query('grade') grade?: string,
    @Query('supplierId') supplierId?: string,
    @Query('source') source?: string,
    @Query('hasStock') hasStockRaw?: string,
    @CurrentUser() user?: ClerkUser,
  ) {
    const hasStock = hasStockRaw === 'true' ? true : hasStockRaw === 'false' ? false : undefined;
    return this.stockLotsService.findAll(
      page,
      limit,
      charcoalType,
      grade,
      supplierId,
      source,
      hasStock,
      user?.role,
    );
  }

  /**
   * IMPORTANT: must come before GET /:id so NestJS does not treat
   * "available" as a UUID parameter.
   */
  @ApiOperation({ summary: 'All stock lots with kgRemaining > 0, unbounded (no page cap) — for lot selectors (warehouse-sale KG picker, stock-adjustment picker)' })
  @ApiResponse({ status: 200, description: 'Success' })
  @Get('available')
  @Roles('owner', 'accountant', 'sales_rep', 'worker')
  findAvailable(@CurrentUser() user?: ClerkUser) {
    return this.stockLotsService.findAvailable(user?.role);
  }

  @ApiOperation({ summary: 'Get stock lot by ID with supplier; costPerKg hidden for sales_rep/worker' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Get(':id')
  @Roles('owner', 'accountant', 'sales_rep', 'worker')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user?: ClerkUser,
  ) {
    return this.stockLotsService.findOne(id, user?.role);
  }

  @ApiOperation({ summary: 'Create direct stock lot (source=direct, owner only)' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  @Post()
  @Roles('owner')
  create(
    @Body() dto: CreateStockLotDto,
    @CurrentUser() user: ClerkUser,
  ) {
    return this.stockLotsService.create(dto, user.userId);
  }

  @ApiOperation({ summary: 'Correct a local (direct) purchase, owner only. Type/grade only while unused; kg never below what is used.' })
  @ApiResponse({ status: 200, description: 'Updated' })
  @ApiResponse({ status: 400, description: 'Not a direct lot, or invalid kg/cost' })
  @ApiResponse({ status: 409, description: 'LOT_IN_USE: type/grade change on a used lot' })
  @Patch(':id')
  @Roles('owner')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStockLotDto,
    @CurrentUser() user?: ClerkUser,
  ) {
    return this.stockLotsService.update(id, dto, user?.role);
  }

  @ApiOperation({ summary: 'Delete a local (direct) purchase entered by mistake, owner only, and only while unused' })
  @ApiResponse({ status: 200, description: 'Deleted' })
  @ApiResponse({ status: 409, description: 'LOT_IN_USE: the lot has been packed, sold or adjusted' })
  @Delete(':id')
  @Roles('owner')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.stockLotsService.remove(id);
  }
}
