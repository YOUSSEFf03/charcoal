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
import { GeneralExpensesService } from './general-expenses.service';
import { CreateGeneralExpenseDto } from './dto/create-general-expense.dto';
import { UpdateGeneralExpenseDto } from './dto/update-general-expense.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClerkUser } from '../auth/clerk.strategy';

@ApiTags('general-expenses')
@ApiBearerAuth()
@Controller('general-expenses')
@Roles('owner', 'accountant')
export class GeneralExpensesController {
  constructor(private readonly service: GeneralExpensesService) {}

  @ApiOperation({ summary: 'List general expenses (paginated, optionally filtered by date range)' })
  @ApiResponse({ status: 200 })
  @Get()
  findAll(
    @Query('page', new ParsePagePipe()) page: number,
    @Query('limit', new ParseLimitPipe(100)) limit: number,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.service.findAll(page, limit, dateFrom, dateTo);
  }

  @ApiOperation({ summary: 'Get a general expense by ID' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @ApiOperation({ summary: 'Create a general expense' })
  @ApiResponse({ status: 201 })
  @Post()
  create(@Body() dto: CreateGeneralExpenseDto, @CurrentUser() user: ClerkUser) {
    return this.service.create(dto, user.userId);
  }

  @ApiOperation({ summary: 'Update a general expense (owner only)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  @Patch(':id')
  @Roles('owner')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGeneralExpenseDto) {
    return this.service.update(id, dto);
  }

  @ApiOperation({ summary: 'Delete a general expense (owner only)' })
  @ApiResponse({ status: 204 })
  @Delete(':id')
  @HttpCode(204)
  @Roles('owner')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
