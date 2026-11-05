import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { WasteEntryType } from '@prisma/client';
import { ParseLimitPipe, ParsePagePipe } from '../common/pipes/pagination.pipes';
import { WasteService } from './waste.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClerkUser } from '../auth/clerk.strategy';
import { CreateWasteDisposalDto } from './dto/create-waste-disposal.dto';

@ApiTags('waste')
@ApiBearerAuth()
@Controller('waste')
export class WasteController {
  constructor(private readonly wasteService: WasteService) {}

  @ApiOperation({ summary: 'Waste-pool balance + this-month activity (kg on hand, collected/sold/disposed this month)' })
  @ApiResponse({ status: 200, description: 'Success' })
  @Get('summary')
  @Roles('owner', 'accountant', 'sales_rep', 'worker')
  getSummary() {
    return this.wasteService.getSummary();
  }

  @ApiOperation({ summary: 'Paginated waste-pool ledger (append-only; every row that moved WasteStock.kgOnHand)' })
  @ApiResponse({ status: 200, description: 'Success' })
  @Get('ledger')
  @Roles('owner', 'accountant', 'sales_rep', 'worker')
  getLedger(
    @Query('page', new ParsePagePipe()) page: number,
    @Query('limit', new ParseLimitPipe(20)) limit: number,
    @Query('type') type?: WasteEntryType,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.wasteService.getLedger(page, limit, type, dateFrom, dateTo);
  }

  @ApiOperation({ summary: 'Record waste thrown away (removes kg from the waste pool)' })
  @ApiResponse({ status: 201, description: 'Disposal recorded' })
  @ApiResponse({ status: 400, description: 'WASTE_POOL_INSUFFICIENT — not enough waste in the pool' })
  @Post('disposals')
  @Roles('owner', 'accountant')
  createDisposal(@Body() dto: CreateWasteDisposalDto, @CurrentUser() user: ClerkUser) {
    return this.wasteService.createDisposal(dto, user.userId);
  }
}
