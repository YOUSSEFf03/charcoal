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
import { StockAdjustmentsService } from './stock-adjustments.service';
import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClerkUser } from '../auth/clerk.strategy';

@ApiTags('stock-adjustments')
@ApiBearerAuth()
@Controller('stock-adjustments')
export class StockAdjustmentsController {
  constructor(private readonly stockAdjustmentsService: StockAdjustmentsService) {}

  @ApiOperation({ summary: 'List stock adjustments (owner only)' })
  @ApiResponse({ status: 200, description: 'Success' })
  @Get()
  @Roles('owner')
  findAll(
    @Query('page', new ParsePagePipe()) page: number,
    @Query('limit', new ParseLimitPipe(20)) limit: number,
    @Query('adjustmentType') adjustmentType?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('status') status?: string,
  ) {
    return this.stockAdjustmentsService.findAll(page, limit, adjustmentType, dateFrom, dateTo, status);
  }

  @ApiOperation({ summary: 'Get stock adjustment by ID' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Get(':id')
  @Roles('owner')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.stockAdjustmentsService.findOne(id);
  }

  @ApiOperation({ summary: 'Update adjustment reason or qtyAfter (reverses old qty, applies new)' })
  @ApiResponse({ status: 200, description: 'Updated' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Patch(':id')
  @Roles('owner')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { qtyAfter?: string; reason?: string },
  ) {
    return this.stockAdjustmentsService.update(id, dto);
  }

  @ApiOperation({ summary: 'Delete adjustment and reverse its effect on stock' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Delete(':id')
  @Roles('owner')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.stockAdjustmentsService.remove(id);
  }

  @ApiOperation({
    summary: 'Create stock adjustment (BUG-H two-step flow). Owner self-approves and applies immediately; ' +
      'a counter (accountant/worker) submits a PENDING adjustment that an owner must approve.',
  })
  @ApiResponse({ status: 201, description: 'Created (approved if owner, pending otherwise)' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  @Post()
  @Roles('owner', 'accountant', 'worker')
  create(
    @Body() dto: CreateStockAdjustmentDto,
    @CurrentUser() user: ClerkUser,
  ) {
    return this.stockAdjustmentsService.create(dto, user.userId);
  }

  @ApiOperation({ summary: 'Approve a pending stock adjustment (owner only) — applies the atomic delta' })
  @ApiResponse({ status: 200, description: 'Approved and applied' })
  @ApiResponse({ status: 400, description: 'Not pending, or approver equals counter' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Post(':id/approve')
  @Roles('owner')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: ClerkUser,
  ) {
    return this.stockAdjustmentsService.approve(id, user.userId);
  }

  @ApiOperation({ summary: 'Reject a pending stock adjustment (owner only) — discards it, no stock change' })
  @ApiResponse({ status: 200, description: 'Rejected' })
  @ApiResponse({ status: 400, description: 'Not pending' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Post(':id/reject')
  @Roles('owner')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: ClerkUser,
  ) {
    return this.stockAdjustmentsService.reject(id, user.userId);
  }
}
