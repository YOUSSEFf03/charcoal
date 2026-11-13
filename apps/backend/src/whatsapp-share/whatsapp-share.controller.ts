import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { ClerkUser } from '../auth/clerk.strategy';
import { WhatsAppShareService } from './whatsapp-share.service';
import { PrepareWhatsAppShareDto } from './dto/prepare-whatsapp-share.dto';
import { ReportWhatsAppShareOutcomeDto } from './dto/report-whatsapp-share-outcome.dto';

@ApiTags('whatsapp-shares')
@ApiBearerAuth()
@Controller('whatsapp-shares')
export class WhatsAppShareController {
  constructor(private readonly service: WhatsAppShareService) {}

  @ApiOperation({ summary: 'Authorize preparing a document in WhatsApp Web (the user sends manually)' })
  @ApiResponse({ status: 201, description: 'Prepared — returns shareId and the normalized phone digits' })
  @ApiResponse({ status: 403, description: 'Role may not share this document type' })
  @ApiResponse({ status: 404, description: 'Document does not exist or belongs to another customer' })
  @ApiResponse({ status: 422, description: 'Invalid phone number or request body' })
  @Post()
  @Roles('owner', 'accountant', 'sales_rep')
  prepare(@Body() dto: PrepareWhatsAppShareDto, @CurrentUser() user: ClerkUser) {
    return this.service.prepare(dto, user);
  }

  @ApiOperation({ summary: 'Record how the WhatsApp preparation ended (never "sent")' })
  @ApiResponse({ status: 204 })
  @Post(':id/outcome')
  @HttpCode(204)
  @Roles('owner', 'accountant', 'sales_rep')
  reportOutcome(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportWhatsAppShareOutcomeDto,
    @CurrentUser() user: ClerkUser,
  ) {
    this.service.reportOutcome(id, dto, user);
  }
}
