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
import { ClientType } from '@prisma/client';
import { ParseLimitPipe, ParsePagePipe } from '../common/pipes/pagination.pipes';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { AddPhoneDto } from './dto/add-phone.dto';
import { DeactivatePhoneDto } from './dto/deactivate-phone.dto';
import { CreateClientLocationDto } from './dto/create-client-location.dto';
import { UpdateClientLocationDto } from './dto/update-client-location.dto';
import { Roles } from '../auth/roles.decorator';

@ApiTags('clients')
@ApiBearerAuth()
@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @ApiOperation({ summary: 'List all clients (paginated, searchable)' })
  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 400, description: 'Bad request / constraint violation' })
  @Get()
  @Roles('owner', 'sales_rep')
  findAll(
    @Query('page', new ParsePagePipe()) page: number,
    @Query('limit', new ParseLimitPipe(20)) limit: number,
    @Query('search') search?: string,
    @Query('type') type?: ClientType,
    @Query('isActive') isActiveRaw?: string,
    @Query('excludeFillClient') excludeFillClientRaw?: string,
    @Query('hasBalance') hasBalanceRaw?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
    @Query('minTotalInvoiced') minTotalInvoicedRaw?: string,
    @Query('maxTotalInvoiced') maxTotalInvoicedRaw?: string,
  ) {
    const isActive = isActiveRaw === 'true' ? true : isActiveRaw === 'false' ? false : undefined;
    const excludeFillClient = excludeFillClientRaw === 'true';
    const hasBalance =
      hasBalanceRaw === 'true' ? true :
      hasBalanceRaw === 'false' ? false :
      undefined;
    const minTotalInvoiced = minTotalInvoicedRaw !== undefined && minTotalInvoicedRaw !== '' && !isNaN(Number(minTotalInvoicedRaw))
      ? Number(minTotalInvoicedRaw) : undefined;
    const maxTotalInvoiced = maxTotalInvoicedRaw !== undefined && maxTotalInvoicedRaw !== '' && !isNaN(Number(maxTotalInvoicedRaw))
      ? Number(maxTotalInvoicedRaw) : undefined;
    return this.clientsService.findAll(page, limit, search, type, isActive, excludeFillClient, hasBalance, sortBy, sortOrder, minTotalInvoiced, maxTotalInvoiced);
  }

  /**
   * IMPORTANT: these routes MUST come before /:id to avoid NestJS routing
   * treating "counts" or "overdue" as UUID parameters.
   */
  @ApiOperation({ summary: 'Tab counts — allCount, balanceCount, overdueCount (excludes fill_client)' })
  @ApiResponse({ status: 200, description: 'OK' })
  @Get('counts')
  @Roles('owner', 'sales_rep')
  getCounts(@Query('search') search?: string) {
    return this.clientsService.getCounts(search);
  }

  @ApiOperation({ summary: 'List overdue clients (balance > 0, last order > 30 days ago)' })
  @ApiResponse({ status: 200, description: 'OK' })
  @Get('overdue')
  @Roles('owner', 'sales_rep')
  findOverdue() {
    return this.clientsService.findOverdue();
  }

  @ApiOperation({ summary: 'Get a client by ID with computed balance' })
  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Get(':id')
  @Roles('owner', 'sales_rep')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.clientsService.findOne(id);
  }

  @ApiOperation({ summary: 'Create a new client' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 400, description: 'Bad request / constraint violation' })
  @Post()
  @Roles('owner', 'sales_rep')
  create(@Body() dto: CreateClientDto) {
    return this.clientsService.create(dto);
  }

  @ApiOperation({ summary: 'Update a client' })
  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 400, description: 'Bad request / constraint violation' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Patch(':id')
  @Roles('owner', 'sales_rep')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClientDto,
  ) {
    return this.clientsService.update(id, dto);
  }

  @ApiOperation({ summary: 'Add a phone number to a client' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 400, description: 'Bad request / constraint violation' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Post(':id/phones')
  @Roles('owner', 'sales_rep')
  addPhone(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddPhoneDto,
  ) {
    return this.clientsService.addPhone(id, dto);
  }

  /**
   * CONSTRAINT 14: phones are never deleted, only deactivated.
   * There is intentionally no DELETE endpoint for phones.
   */
  @ApiOperation({ summary: 'Deactivate a client phone number (never deleted)' })
  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 400, description: 'Bad request / constraint violation' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Patch(':id/phones/deactivate')
  @Roles('owner', 'sales_rep')
  deactivatePhone(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeactivatePhoneDto,
  ) {
    return this.clientsService.deactivatePhone(id, dto);
  }

  // ── Client Locations (forensic audit, 2026-08-31) ─────────────────────────
  // Provenance for normal Orders only — never a second financial account. See
  // ClientsService's Client Locations section doc comment.
  @ApiOperation({ summary: 'List a client\'s locations (active + inactive)' })
  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 404, description: 'Client not found' })
  @Get(':id/locations')
  @Roles('owner', 'accountant', 'sales_rep')
  listLocations(@Param('id', ParseUUIDPipe) id: string) {
    return this.clientsService.listLocations(id);
  }

  @ApiOperation({ summary: 'Add a location to a client (find-or-conflict, case-insensitive within this client)' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 404, description: 'Client not found' })
  @ApiResponse({ status: 409, description: 'A location with this name already exists for this client' })
  @Post(':id/locations')
  @Roles('owner', 'sales_rep')
  createLocation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateClientLocationDto,
  ) {
    return this.clientsService.createLocation(id, dto);
  }

  /**
   * There is intentionally no DELETE endpoint for locations — deactivate
   * (isActive: false in the body) instead, mirroring phones' CONSTRAINT 14
   * (never deleted, only deactivated).
   */
  @ApiOperation({ summary: 'Update a client location, including deactivate/reactivate (never deleted)' })
  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 404, description: 'Client or location not found' })
  @ApiResponse({ status: 409, description: 'A location with this name already exists for this client' })
  @Patch(':id/locations/:locationId')
  @Roles('owner', 'sales_rep')
  updateLocation(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Body() dto: UpdateClientLocationDto,
  ) {
    return this.clientsService.updateLocation(id, locationId, dto);
  }

  @ApiOperation({ summary: 'Get computed balance for a client' })
  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Get(':id/balance')
  @Roles('owner', 'accountant', 'sales_rep')
  getBalance(@Param('id', ParseUUIDPipe) id: string) {
    return this.clientsService.getBalance(id);
  }

  @ApiOperation({ summary: 'Get orders for a client' })
  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Get(':id/orders')
  @Roles('owner', 'sales_rep')
  getOrders(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page', new ParsePagePipe()) page: number,
    @Query('limit', new ParseLimitPipe(20)) limit: number,
  ) {
    return this.clientsService.getOrders(id, page, limit);
  }

  @ApiOperation({ summary: 'Get invoices for a client' })
  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Get(':id/invoices')
  @Roles('owner', 'accountant', 'sales_rep')
  getInvoices(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page', new ParsePagePipe()) page: number,
    @Query('limit', new ParseLimitPipe(20)) limit: number,
  ) {
    return this.clientsService.getInvoices(id, page, limit);
  }

  @ApiOperation({ summary: 'Get payments for a client' })
  @ApiResponse({ status: 200, description: 'OK' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Get(':id/payments')
  @Roles('owner', 'accountant', 'sales_rep')
  getPayments(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page', new ParsePagePipe()) page: number,
    @Query('limit', new ParseLimitPipe(20)) limit: number,
  ) {
    return this.clientsService.getPayments(id, page, limit);
  }
}
