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
import { ExitType } from '@prisma/client';
import { ParseLimitPipe, ParsePagePipe } from '../common/pipes/pagination.pipes';
import { StockExitsService } from './stock-exits.service';
import { CreateStockExitDto } from './dto/create-stock-exit.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClerkUser } from '../auth/clerk.strategy';

@ApiTags('stock-exits')
@ApiBearerAuth()
@Controller('stock-exits')
export class StockExitsController {
  constructor(private readonly stockExitsService: StockExitsService) {}

  @ApiOperation({ summary: 'List stock exits (paginated, filterable)' })
  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 400, description: 'Bad request / constraint violation' })
  @Get()
  @Roles('owner', 'accountant', 'sales_rep')
  findAll(
    @Query('page', new ParsePagePipe()) page: number,
    @Query('limit', new ParseLimitPipe(20)) limit: number,
    @Query('exitType') exitType?: ExitType,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('clientId') clientId?: string,
    @Query('lotId') lotId?: string,
  ) {
    return this.stockExitsService.findAll(page, limit, exitType, dateFrom, dateTo, clientId, lotId);
  }

  /**
   * IMPORTANT: must come before GET /:id so NestJS does not treat "summary"
   * as a UUID parameter.
   */
  @ApiOperation({ summary: 'Walk-in sales aggregate for a date range (bags + kg, no page limit)' })
  @ApiResponse({ status: 200, description: 'OK' })
  @Get('summary')
  @Roles('owner', 'sales_rep')
  getWalkInSummary(
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    return this.stockExitsService.getWalkInSummary(dateFrom, dateTo);
  }

  @ApiOperation({ summary: 'Get a stock exit by ID' })
  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Get(':id')
  @Roles('owner', 'accountant', 'sales_rep')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.stockExitsService.findOne(id);
  }

  /**
   * CONSTRAINT 5: loggedById is taken from @CurrentUser, never from the DTO body.
   */
  @ApiOperation({ summary: 'Update sale amount and/or recipient on an exit' })
  @ApiResponse({ status: 200, description: 'Updated' })
  @Patch(':id')
  @Roles('owner', 'sales_rep')
  async updateExit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { amount?: number; recipient?: string },
  ) {
    return this.stockExitsService.updateExit(id, dto);
  }

  @ApiOperation({ summary: 'Create a stock exit (decrements packed stock)' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 400, description: 'Bad request / constraint violation' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Post()
  @Roles('owner', 'sales_rep', 'worker')
  create(
    @Body() dto: CreateStockExitDto,
    @CurrentUser() user: ClerkUser,
  ) {
    return this.stockExitsService.create(dto, user.userId);
  }
}
