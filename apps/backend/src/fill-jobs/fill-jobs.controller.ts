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
import { FillJobsService } from './fill-jobs.service';
import { CreateFillJobDto } from './dto/create-fill-job.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClerkUser } from '../auth/clerk.strategy';

@ApiTags('fill-jobs')
@ApiBearerAuth()
@Controller('fill-jobs')
export class FillJobsController {
  constructor(private readonly fillJobsService: FillJobsService) {}

  @ApiOperation({ summary: 'List fill jobs for a client' })
  @ApiResponse({ status: 200, description: 'Success' })
  @Get()
  @Roles('owner', 'accountant', 'sales_rep')
  findAll(
    @Query('clientId', ParseUUIDPipe) clientId: string,
    @Query('page', new ParsePagePipe()) page: number,
    @Query('limit', new ParseLimitPipe(50)) limit: number,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.fillJobsService.findAll(clientId, page, limit, dateFrom, dateTo);
  }

  @ApiOperation({ summary: 'Net bags in warehouse per bag spec for a client (produced minus picked up), unbounded' })
  @ApiResponse({ status: 200, description: 'Map of specKey -> netStock' })
  @Get('net-stock')
  @Roles('owner', 'accountant', 'sales_rep')
  getNetStock(@Query('clientId', ParseUUIDPipe) clientId: string) {
    return this.fillJobsService.getNetStock(clientId);
  }

  @ApiOperation({ summary: 'Get avg and last fill price per bag spec for a client' })
  @ApiResponse({ status: 200, description: 'Map of specKey -> { avgFillPrice, lastFillPrice }' })
  @Get('price-stats')
  @Roles('owner', 'accountant', 'sales_rep')
  getPriceStats(@Query('clientId', ParseUUIDPipe) clientId: string) {
    return this.fillJobsService.getPriceStats(clientId);
  }

  @ApiOperation({ summary: 'Year-to-date fill-client KPI summary (bags, waste, revenue, cost, profit, margin), unbounded per client' })
  @ApiResponse({ status: 200, description: 'YTD summary' })
  @Get('ytd-summary')
  @Roles('owner', 'accountant', 'sales_rep')
  getYtdSummary(@Query('clientId', ParseUUIDPipe) clientId: string) {
    return this.fillJobsService.getYtdSummary(clientId);
  }

  /**
   * IMPORTANT: must come after the literal-path GET routes above (net-stock,
   * price-stats, ytd-summary) so NestJS does not treat those path segments as
   * a UUID :id param — same convention as StockLotsController's 'available'.
   */
  @ApiOperation({ summary: 'Get a fill job by ID' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  @Get(':id')
  @Roles('owner', 'accountant', 'sales_rep')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.fillJobsService.findOne(id);
  }

  @ApiOperation({ summary: 'Create a fill job (auto-calculates fill price from stock lot cost)' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Stock lot not found' })
  @Post()
  @Roles('owner', 'worker')
  create(@Body() dto: CreateFillJobDto, @CurrentUser() user: ClerkUser) {
    return this.fillJobsService.create(dto, user.userId);
  }
}
