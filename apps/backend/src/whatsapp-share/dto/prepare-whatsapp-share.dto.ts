import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, IsUUID, MaxLength } from 'class-validator';

export const WHATSAPP_DOCUMENT_TYPES = ['invoice', 'delivery_receipt', 'client_statement', 'supplier_statement'] as const;
export type WhatsAppDocumentType = (typeof WHATSAPP_DOCUMENT_TYPES)[number];

/** POST /whatsapp-shares — authorize preparing a document for manual WhatsApp sending. */
export class PrepareWhatsAppShareDto {
  @ApiProperty({ enum: WHATSAPP_DOCUMENT_TYPES })
  @IsIn(WHATSAPP_DOCUMENT_TYPES)
  documentType!: WhatsAppDocumentType;

  /** Invoice id, order id (delivery receipt), or the party id itself for statements. */
  @ApiProperty()
  @IsUUID()
  documentId!: string;

  /** The client (or supplier, for supplier_statement) the document is for. */
  @ApiProperty()
  @IsUUID()
  customerId!: string;

  @ApiProperty({ example: '+961 70 123 456' })
  @IsString()
  @MaxLength(40)
  phoneNumber!: string;
}
