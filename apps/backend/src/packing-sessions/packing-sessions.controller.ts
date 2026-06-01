import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ParseLimitPipe, ParsePagePipe } from '../common/pipes/pagination.pipes';
import { PackingSessionsService } from './packing-sessions.service';
import { CreatePackingSessionDto } from './dto/create-packing-session.dto';
import { UpdatePackingSessionDto } from './dto/update-packing-session.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClerkUser } from '../auth/clerk.strategy';

@ApiTags('packing-sessions')
@ApiBearerAuth()
@Controller('packing-sessions')
export class PackingSessionsController {
  constructor(private readonly packingSessionsService: PackingSessionsService) {}

  @ApiOperation({ summary: 'List packing sessions; workers see only their own' })
  @ApiResponse({ status: 200, description: 'Success' })
  @Get()
  @Roles('owner', 'accountant', 'worker')
  findAll(
    @Query('page', new ParsePagePipe()) page: number,
    @Query('limit', new ParseLimitPipe(20)) limit: number,
    @Query('workerId') workerId?: string,
    @Query('lotId') lotId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('workerEntityId') workerEntityId?: string,
    @CurrentUser() user?: ClerkUser,
  ) {
    return this.packingSessionsService.findAll(
      page,
      limit,
      workerId,
      lotId,
      dateFrom,
      dateTo,
      user,
      workerEntityId,
    );
  }

  @ApiOperation({ summary: 'Get session by ID; workers restricted to own sessions' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Get(':id')
  @Roles('owner', 'accountant', 'worker')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: ClerkUser,
  ) {
    return this.packingSessionsService.findOne(id, user);
  }

  @ApiOperation({ summary: 'Create packing session (full transactional validation)' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  @Post()
  @Roles('owner', 'worker')
  create(
    @Body() dto: CreatePackingSessionDto,
    @CurrentUser() user: ClerkUser,
  ) {
    return this.packingSessionsService.createPackingSession(dto, user.userId);
  }

  @ApiOperation({ summary: 'Update packing session (reverses and re-applies lot deductions, packed stock, and worker earnings)' })
  @ApiResponse({ status: 200, description: 'Updated' })
  @ApiResponse({ status: 400, description: 'Bad request / edit blocked by downstream records' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Patch(':id')
  @Roles('owner', 'worker')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePackingSessionDto,
    @CurrentUser() user: ClerkUser,
  ) {
    return this.packingSessionsService.updatePackingSession(id, dto, user.userId);
  }
}
