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
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ParseLimitPipe, ParsePagePipe } from '../common/pipes/pagination.pipes';
import { ContainersService } from './containers.service';
import { CreateContainerDto } from './dto/create-container.dto';
import { UpdateContainerDto } from './dto/update-container.dto';
import { CreateProductLineDto } from './dto/create-product-line.dto';
import { UpdateProductLineDto } from './dto/update-product-line.dto';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { UpsertDiscountDto } from './dto/upsert-discount.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClerkUser } from '../auth/clerk.strategy';

@ApiTags('containers')
@ApiBearerAuth()
@Controller('containers')
export class ContainersController {
  constructor(private readonly containersService: ContainersService) {}

  // ---------------------------------------------------------------------------
  // Container endpoints
  // ---------------------------------------------------------------------------

  @ApiOperation({ summary: 'List containers (paginated, filterable by status/supplierId/search)' })
  @ApiResponse({ status: 200, description: 'Containers returned' })
  @Get()
  @Roles('owner', 'accountant', 'sales_rep')
  findAll(
    @Query('page', new ParsePagePipe()) page: number,
    @Query('limit', new ParseLimitPipe(20)) limit: number,
    @Query('status') status?: string,
    @Query('supplierId') supplierId?: string,
    @Query('search') search?: string,
    @CurrentUser() user?: ClerkUser,
  ) {
    return this.containersService.findAll(
      page,
      limit,
      status,
      supplierId,
      search,
      user?.role,
    );
  }

  @ApiOperation({ summary: 'Get full container detail with product lines, expenses, discount, and computed totals' })
  @ApiResponse({ status: 200, description: 'Container returned' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Get(':id')
  @Roles('owner', 'accountant', 'sales_rep')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user?: ClerkUser,
  ) {
    return this.containersService.findOne(id, user?.role);
  }

  @ApiOperation({ summary: 'Create a new container' })
  @ApiResponse({ status: 201, description: 'Container created' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  @Post()
  @Roles('owner')
  create(
    @Body() dto: CreateContainerDto,
    @CurrentUser() user: ClerkUser,
  ) {
    return this.containersService.create(dto, user.userId);
  }

  @ApiOperation({ summary: 'Update container fields; setting status=arrived triggers transactional StockLot creation' })
  @ApiResponse({ status: 200, description: 'Container returned' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 409, description: 'Conflict' })
  @Patch(':id')
  @Roles('owner')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContainerDto,
    @CurrentUser() user: ClerkUser,
  ) {
    return this.containersService.update(id, dto, user.userId);
  }

  @ApiOperation({ summary: 'Delete container — blocked if status=arrived' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 409, description: 'Conflict' })
  @Delete(':id')
  @Roles('owner')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.containersService.remove(id);
  }

  @ApiOperation({ summary: 'List StockLots created from this container on arrival' })
  @ApiResponse({ status: 200, description: 'StockLots returned' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Get(':id/stock-lots')
  @Roles('owner', 'accountant')
  findStockLots(@Param('id', ParseUUIDPipe) id: string) {
    return this.containersService.findStockLots(id);
  }

  // ---------------------------------------------------------------------------
  // Product line endpoints
  // ---------------------------------------------------------------------------

  @ApiOperation({ summary: 'List product lines; cost fields hidden for sales_rep' })
  @ApiResponse({ status: 200, description: 'Product lines returned' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Get(':containerId/product-lines')
  @Roles('owner', 'accountant', 'sales_rep')
  findProductLines(
    @Param('containerId', ParseUUIDPipe) containerId: string,
    @CurrentUser() user?: ClerkUser,
  ) {
    return this.containersService.findProductLines(containerId, user?.role);
  }

  @ApiOperation({ summary: 'Add a product line; triggers cost recalculation if container is arrived' })
  @ApiResponse({ status: 201, description: 'Product line created' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  @Post(':containerId/product-lines')
  @Roles('owner')
  createProductLine(
    @Param('containerId', ParseUUIDPipe) containerId: string,
    @Body() dto: CreateProductLineDto,
  ) {
    return this.containersService.createProductLine(containerId, dto);
  }

  @ApiOperation({ summary: 'Update a product line; triggers cost recalculation (CONSTRAINT 9)' })
  @ApiResponse({ status: 200, description: 'Product line returned' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Patch(':containerId/product-lines/:lineId')
  @Roles('owner')
  updateProductLine(
    @Param('containerId', ParseUUIDPipe) containerId: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: UpdateProductLineDto,
  ) {
    return this.containersService.updateProductLine(containerId, lineId, dto);
  }

  @ApiOperation({ summary: 'Delete a product line — blocked if container is arrived' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Delete(':containerId/product-lines/:lineId')
  @Roles('owner')
  @HttpCode(204)
  removeProductLine(
    @Param('containerId', ParseUUIDPipe) containerId: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
  ) {
    return this.containersService.removeProductLine(containerId, lineId);
  }

  // ---------------------------------------------------------------------------
  // Expense endpoints
  // ---------------------------------------------------------------------------

  @ApiOperation({ summary: 'List container expenses' })
  @ApiResponse({ status: 200, description: 'Expenses returned' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Get(':containerId/expenses')
  @Roles('owner', 'accountant')
  findExpenses(@Param('containerId', ParseUUIDPipe) containerId: string) {
    return this.containersService.findExpenses(containerId);
  }

  @ApiOperation({ summary: 'Add expense; immediately recalculates costPerKg on all linked lots (CONSTRAINT 9)' })
  @ApiResponse({ status: 201, description: 'Expense created' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  @Post(':containerId/expenses')
  @Roles('owner', 'accountant')
  createExpense(
    @Param('containerId', ParseUUIDPipe) containerId: string,
    @Body() dto: CreateExpenseDto,
    @CurrentUser() user: ClerkUser,
  ) {
    return this.containersService.createExpense(containerId, dto, user.userId);
  }

  @ApiOperation({ summary: 'Update expense amount/description; triggers recalculation' })
  @ApiResponse({ status: 200, description: 'Expense returned' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Patch(':containerId/expenses/:expenseId')
  @Roles('owner', 'accountant')
  updateExpense(
    @Param('containerId', ParseUUIDPipe) containerId: string,
    @Param('expenseId', ParseUUIDPipe) expenseId: string,
    @Body() dto: UpdateExpenseDto,
  ) {
    return this.containersService.updateExpense(containerId, expenseId, dto);
  }

  @ApiOperation({ summary: 'Delete expense; triggers recalculation' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Delete(':containerId/expenses/:expenseId')
  @Roles('owner')
  @HttpCode(204)
  removeExpense(
    @Param('containerId', ParseUUIDPipe) containerId: string,
    @Param('expenseId', ParseUUIDPipe) expenseId: string,
  ) {
    return this.containersService.removeExpense(containerId, expenseId);
  }

  // ---------------------------------------------------------------------------
  // Discount endpoints
  // ---------------------------------------------------------------------------

  @ApiOperation({ summary: 'Get container discount (null if none)' })
  @ApiResponse({ status: 200, description: 'Discount returned' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Get(':containerId/discount')
  @Roles('owner', 'accountant')
  findDiscount(@Param('containerId', ParseUUIDPipe) containerId: string) {
    return this.containersService.findDiscount(containerId);
  }

  @ApiOperation({ summary: 'Upsert discount; triggers recalculation' })
  @ApiResponse({ status: 200, description: 'Discount returned' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  @Put(':containerId/discount')
  @Roles('owner')
  upsertDiscount(
    @Param('containerId', ParseUUIDPipe) containerId: string,
    @Body() dto: UpsertDiscountDto,
  ) {
    return this.containersService.upsertDiscount(containerId, dto);
  }

  @ApiOperation({ summary: 'Remove discount; triggers recalculation' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Delete(':containerId/discount')
  @Roles('owner')
  @HttpCode(204)
  removeDiscount(@Param('containerId', ParseUUIDPipe) containerId: string) {
    return this.containersService.removeDiscount(containerId);
  }
}
