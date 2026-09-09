import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { TraqoAccountsService } from './traqo-accounts.service';
import { UpdateTraqoAccountDto } from './dto/update-traqo-account.dto';

/**
 * Owner-only admin view of the 3 Traqo tracking accounts (Settings →
 * Traqo accounts). Never exposes a key value — see TraqoAccountsService.
 */
@ApiTags('Traqo Accounts')
@ApiBearerAuth()
@Controller('traqo-accounts')
@Roles('owner')
export class TraqoAccountsController {
  constructor(private readonly traqoAccountsService: TraqoAccountsService) {}

  @ApiOperation({ summary: 'List Traqo accounts with computed active-container usage' })
  @ApiResponse({ status: 200, description: 'Account list — never includes a key value' })
  @Get()
  findAll() {
    return this.traqoAccountsService.listWithUsage();
  }

  @ApiOperation({ summary: 'Enable or disable a Traqo account for new allocations' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: 'Account not found' })
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTraqoAccountDto) {
    return this.traqoAccountsService.setActive(id, dto.active);
  }
}
