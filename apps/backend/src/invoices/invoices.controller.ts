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
import { InvoiceStatus } from '@prisma/client';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { Roles } from '../auth/roles.decorator';

@ApiTags('invoices')
@ApiBearerAuth()
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @ApiOperation({ summary: 'List invoices (paginated)' })
  @ApiResponse({ status: 200, description: 'Paginated invoice list' })
  @Get()
  @Roles('owner', 'accountant', 'sales_rep')
  findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('clientId') clientId?: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.invoicesService.findAll(page, limit, clientId, status, dateFrom, dateTo);
  }

  @ApiOperation({ summary: 'Get an invoice by ID' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  @Get(':id')
  @Roles('owner', 'accountant', 'sales_rep')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoicesService.findOne(id);
  }

  @ApiOperation({ summary: 'Create a new invoice' })
  @ApiResponse({ status: 201, description: 'Draft invoice created' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  @Post()
  @Roles('owner', 'accountant', 'sales_rep')
  create(@Body() dto: CreateInvoiceDto) {
    return this.invoicesService.create(dto);
  }

  @ApiOperation({ summary: 'Update a draft invoice' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400, description: 'Not a draft invoice' })
  @Patch(':id')
  @Roles('owner', 'accountant', 'sales_rep')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.invoicesService.update(id, dto);
  }

  @ApiOperation({ summary: 'Issue an invoice (draft → issued)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400, description: 'INVALID_TRANSITION — not a draft' })
  @Post(':id/issue')
  @Roles('owner', 'accountant', 'sales_rep')
  issue(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoicesService.issue(id);
  }

  @ApiOperation({ summary: 'Cancel an invoice (owner only)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400, description: 'INVALID_TRANSITION — paid or already cancelled' })
  @ApiResponse({ status: 403, description: 'Forbidden — owner only' })
  @Post(':id/cancel')
  @Roles('owner')
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoicesService.cancel(id);
  }

  @ApiOperation({ summary: 'Delete a draft invoice (owner only)' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 400, description: 'Not a draft invoice' })
  @Delete(':id')
  @Roles('owner')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoicesService.remove(id);
  }
}
