import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches, MaxLength } from 'class-validator';

/**
 * Deliberately has no "sent" value: the app can never know whether the user
 * pressed Send in WhatsApp, so it never claims so.
 */
export const WHATSAPP_SHARE_OUTCOMES = ['ready_for_manual_send', 'failed'] as const;

export class ReportWhatsAppShareOutcomeDto {
  @ApiProperty({ enum: WHATSAPP_SHARE_OUTCOMES })
  @IsIn(WHATSAPP_SHARE_OUTCOMES)
  outcome!: (typeof WHATSAPP_SHARE_OUTCOMES)[number];

  @ApiPropertyOptional({ example: 'ATTACH_FAILED' })
  @IsOptional()
  @MaxLength(64)
  @Matches(/^[A-Z_]+$/)
  errorCode?: string;
}
