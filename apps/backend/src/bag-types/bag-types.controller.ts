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
import { BagTypesService } from './bag-types.service';
import { CreateBagTypeDto } from './dto/create-bag-type.dto';
import { UpdateBagTypeDto } from './dto/update-bag-type.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClerkUser } from '../auth/clerk.strategy';

@ApiTags('bag-types')
@ApiBearerAuth()
@Controller('bag-types')
export class BagTypesController {
  constructor(private readonly bagTypesService: BagTypesService) {}

  // Matches stock-lots.controller.ts's role set exactly — driver deliberately
  // excluded (this data is cost-bearing; the service-level redaction below
  // only strips it for sales_rep/worker, so without this controller-level
  // gate a driver would see the raw, unredacted costPerBag/workerRate).
  @ApiOperation({ summary: 'List all bag types; costPerBag/workerRate hidden from sales_rep and worker' })
  @ApiResponse({ status: 200, description: 'List of bag types' })
  @Get()
  @Roles('owner', 'accountant', 'sales_rep', 'worker')
  findAll(
    @Query('page', new ParsePagePipe()) page: number,
    @Query('limit', new ParseLimitPipe(20)) limit: number,
    @CurrentUser() user?: ClerkUser,
  ) {
    return this.bagTypesService.findAll(page, limit, user?.role);
  }

  @ApiOperation({ summary: 'Get a bag type by ID; costPerBag/workerRate hidden from sales_rep and worker' })
  @ApiResponse({ status: 200, description: 'Bag type' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Get(':id')
  @Roles('owner', 'accountant', 'sales_rep', 'worker')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user?: ClerkUser,
  ) {
    return this.bagTypesService.findOne(id, user?.role);
  }

  @ApiOperation({ summary: 'Create a new bag type' })
  @ApiResponse({ status: 201, description: 'Bag type created' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  @Post()
  @Roles('owner')
  create(@Body() dto: CreateBagTypeDto) {
    return this.bagTypesService.create(dto);
  }

  @ApiOperation({ summary: 'Update a bag type' })
  @ApiResponse({ status: 200, description: 'Bag type updated' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Patch(':id')
  @Roles('owner')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBagTypeDto,
  ) {
    return this.bagTypesService.update(id, dto);
  }

  @ApiOperation({ summary: 'Delete a bag type' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 409, description: 'Bag type has linked records' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Delete(':id')
  @Roles('owner')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.bagTypesService.remove(id);
  }
}
