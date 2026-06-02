import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { WalkInSalesService } from './walk-in-sales.service';
import { CreateWalkInSaleDto } from './dto/create-walk-in-sale.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClerkUser } from '../auth/clerk.strategy';

@ApiTags('walk-in-sales')
@ApiBearerAuth()
@Controller('walk-in-sales')
export class WalkInSalesController {
  constructor(private readonly service: WalkInSalesService) {}

  @ApiOperation({
    summary:
      'Record a walk-in sale to a registered client: stock exit + issued invoice + payment in one atomic transaction',
  })
  @ApiResponse({ status: 201, description: 'Created — returns the issued invoice with its payment' })
  @ApiResponse({ status: 400, description: 'Constraint violation or missing/zero exchange rate' })
  @ApiResponse({ status: 404, description: 'Client, user, or packed stock not found' })
  @Post()
  @Roles('owner', 'sales_rep')
  create(@Body() dto: CreateWalkInSaleDto, @CurrentUser() user: ClerkUser) {
    return this.service.create(dto, user.userId);
  }
}
