import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { FillJobsService } from './fill-jobs.service';
import { CreateFillJobDto } from './dto/create-fill-job.dto';
import { Roles } from '../auth/roles.decorator';

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
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.fillJobsService.findAll(clientId, page, limit);
  }

  @ApiOperation({ summary: 'Get avg and last fill price per bag spec for a client' })
  @ApiResponse({ status: 200, description: 'Map of specKey -> { avgFillPrice, lastFillPrice }' })
  @Get('price-stats')
  @Roles('owner', 'accountant', 'sales_rep')
  getPriceStats(@Query('clientId', ParseUUIDPipe) clientId: string) {
    return this.fillJobsService.getPriceStats(clientId);
  }

  @ApiOperation({ summary: 'Create a fill job (auto-calculates fill price from stock lot cost)' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Stock lot not found' })
  @Post()
  @Roles('owner', 'worker')
  create(@Body() dto: CreateFillJobDto) {
    return this.fillJobsService.create(dto);
  }
}
