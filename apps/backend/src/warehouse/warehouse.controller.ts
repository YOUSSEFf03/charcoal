import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { WarehouseService } from './warehouse.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClerkUser } from '../auth/clerk.strategy';

@ApiTags('warehouse')
@ApiBearerAuth()
@Controller('warehouse')
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) {}

  @ApiOperation({ summary: 'Warehouse summary; estimatedTotalValue hidden from sales_rep and worker' })
  @ApiResponse({ status: 200, description: 'Success' })
  @Get('summary')
  getSummary(@CurrentUser() user?: ClerkUser) {
    return this.warehouseService.getSummary(user?.role);
  }
}
