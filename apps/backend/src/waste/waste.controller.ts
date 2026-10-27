import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { WasteEntryType } from '@prisma/client';
import { ParseLimitPipe, ParsePagePipe } from '../common/pipes/pagination.pipes';
import { WasteService } from './waste.service';
import { Roles } from '../auth/roles.decorator';

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
}
