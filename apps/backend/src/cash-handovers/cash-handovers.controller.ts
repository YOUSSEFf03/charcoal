import { Body, Controller, Get, ParseUUIDPipe, Post, Query, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ParseLimitPipe, ParsePagePipe } from '../common/pipes/pagination.pipes';
import { CashHandoversService } from './cash-handovers.service';
import { CreateCashHandoverDto } from './dto/create-cash-handover.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClerkUser } from '../auth/clerk.strategy';

@ApiTags('cash-handovers')
@ApiBearerAuth()
@Controller('cash-handovers')
@Roles('owner', 'accountant')
export class CashHandoversController {
  constructor(private readonly service: CashHandoversService) {}

  @ApiOperation({ summary: 'List cash handovers' })
  @Get()
  findAll(
    @Query('page', new ParsePagePipe()) page: number,
    @Query('limit', new ParseLimitPipe(20)) limit: number,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('search') search?: string,
  ) {
    return this.service.findAll(page, limit, dateFrom, dateTo, search);
  }

  @ApiOperation({ summary: 'All users with balance > 0 — sorted by balance desc. Three aggregation queries.' })
  @Get('balances')
  getAllBalances() {
    return this.service.getAllBalances();
  }

  @ApiOperation({ summary: "Get a receiver's running cash balance by their user ID" })
  @Get('balance/user/:receiverId')
  getReceiverBalance(@Param('receiverId', ParseUUIDPipe) receiverId: string) {
    return this.service.getReceiverBalance(receiverId);
  }

  @ApiOperation({ summary: 'Log a cash handover' })
  @Post()
  create(
    @Body() dto: CreateCashHandoverDto,
    @CurrentUser() user: ClerkUser,
  ) {
    return this.service.create(dto, user.userId);
  }
}
