import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { BagTypesService } from './bag-types.service';
import { CreateBagTypeDto } from './dto/create-bag-type.dto';
import { UpdateBagTypeDto } from './dto/update-bag-type.dto';
import { Roles } from '../auth/roles.decorator';

@ApiTags('bag-types')
@ApiBearerAuth()
@Controller('bag-types')
export class BagTypesController {
  constructor(private readonly bagTypesService: BagTypesService) {}

  @ApiOperation({ summary: 'List all bag types' })
  @ApiResponse({ status: 200, description: 'List of bag types' })
  @Get()
  findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.bagTypesService.findAll(page, limit);
  }

  @ApiOperation({ summary: 'Get a bag type by ID' })
  @ApiResponse({ status: 200, description: 'Bag type' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.bagTypesService.findOne(id);
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
