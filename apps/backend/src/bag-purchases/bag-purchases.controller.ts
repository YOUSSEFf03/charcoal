import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { BagPurchasesService } from './bag-purchases.service';
import { CreateBagPurchaseDto } from './dto/create-bag-purchase.dto';
import { Roles } from '../auth/roles.decorator';

@ApiTags('bag-purchases')
@ApiBearerAuth()
@Controller('bag-purchases')
export class BagPurchasesController {
  constructor(private readonly bagPurchasesService: BagPurchasesService) {}

  @ApiOperation({ summary: 'List all bag purchases' })
  @ApiResponse({ status: 200, description: 'Paginated bag purchases' })
  @Get()
  @Roles('owner', 'accountant')
  findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('bagTypeId') bagTypeId?: string,
  ) {
    return this.bagPurchasesService.findAll(page, limit, bagTypeId);
  }

  @ApiOperation({ summary: 'Get a bag purchase by ID' })
  @ApiResponse({ status: 200, description: 'Bag purchase' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Get(':id')
  @Roles('owner', 'accountant')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.bagPurchasesService.findOne(id);
  }

  @ApiOperation({ summary: 'Log a bag purchase' })
  @ApiResponse({ status: 201, description: 'Bag purchase created' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  @Post()
  @Roles('owner', 'accountant')
  create(@Body() dto: CreateBagPurchaseDto, @Request() req: any) {
    return this.bagPurchasesService.create(dto, req.user.userId);
  }
}
