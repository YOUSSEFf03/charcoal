import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { WarehouseService } from './warehouse.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClerkUser } from '../auth/clerk.strategy';
import { Roles } from '../auth/roles.decorator';

@ApiTags('warehouse')
@ApiBearerAuth()
@Controller('warehouse')
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) {}

  // Matches the other two routes in this same controller — driver deliberately
  // excluded (estimatedTotalValue is cost-bearing; the service-level redaction
  // below only strips it for sales_rep/worker, so without this controller-level
  // gate a driver would see the raw, unredacted value).
  @ApiOperation({ summary: 'Warehouse summary; estimatedTotalValue hidden from sales_rep and worker' })
  @ApiResponse({ status: 200, description: 'Success' })
  @Get('summary')
  @Roles('owner', 'accountant', 'sales_rep', 'worker')
  getSummary(@CurrentUser() user?: ClerkUser) {
    return this.warehouseService.getSummary(user?.role);
  }

  @ApiOperation({
    summary:
      'Material-flow breakdown for one stock lot: received, consumed (packing/fill jobs/direct exits), ' +
      'packed output, waste, remaining — with a per-session allocation so a session spanning multiple ' +
      'lots is never shown as its full output on every contributing lot.',
  })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Get('lots/:id/material-flow')
  @Roles('owner', 'accountant', 'sales_rep', 'worker')
  getLotMaterialFlow(@Param('id', ParseUUIDPipe) id: string) {
    return this.warehouseService.getLotMaterialFlow(id);
  }

  @ApiOperation({
    summary:
      'Material-flow breakdown for one container, rolled up from all of its stock lots. A packing ' +
      'session drawing from multiple lots of the same container is counted once, split by each ' +
      "lot's real share — never once per lot.",
  })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Get('containers/:id/material-flow')
  @Roles('owner', 'accountant', 'sales_rep', 'worker')
  getContainerMaterialFlow(@Param('id', ParseUUIDPipe) id: string) {
    return this.warehouseService.getContainerMaterialFlow(id);
  }
}
