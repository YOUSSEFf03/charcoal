import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { ClerkUser } from '../auth/clerk.strategy';
import { toWhatsAppDigits, validateWhatsAppPhone } from './whatsapp-phone';
import {
  WHATSAPP_DOCUMENT_TYPES,
  type PrepareWhatsAppShareDto,
  type WhatsAppDocumentType,
} from './dto/prepare-whatsapp-share.dto';
import type { ReportWhatsAppShareOutcomeDto } from './dto/report-whatsapp-share-outcome.dto';

/** How long a prepared share may be reported on (and the extension job stays valid). */
export const SHARE_TTL_MS = 10 * 60 * 1000;

/** Roles allowed per document type — mirrors the roles that can READ that document. */
const ROLES_BY_TYPE: Record<WhatsAppDocumentType, readonly string[]> = {
  invoice: ['owner', 'accountant', 'sales_rep'],
  delivery_receipt: ['owner', 'accountant', 'sales_rep'],
  client_statement: ['owner', 'accountant', 'sales_rep'],
  // Supplier data is cost-sensitive (see suppliers.controller.ts): owner/accountant only.
  supplier_statement: ['owner', 'accountant'],
};

interface PreparedShare {
  userId: string;
  documentType: WhatsAppDocumentType;
  documentId: string;
  expiresAt: number;
  reported: boolean;
}

export interface PreparedShareResponse {
  shareId: string;
  phoneDigits: string;
  /** True when the number is one of the party's saved numbers (false = typed by hand). */
  phoneMatchesSaved: boolean;
  preparedAt: string;
  expiresAt: string;
}

/**
 * Authorizes and records a "prepare WhatsApp share" request.
 *
 * This service never sends anything and never claims a message was sent:
 * the PDF is built in the user's browser and handed to the Farah WhatsApp
 * Chrome extension, which stops at WhatsApp's own Send screen. The server's
 * job is to check that the signed-in user may share THIS document with THIS
 * party, that the destination number is valid, and to log the event.
 *
 * Events are written to the application log (journald on the server — the
 * app's existing audit trail for request-level events), not a new table.
 */
@Injectable()
export class WhatsAppShareService {
  private readonly logger = new Logger('WhatsAppShare');
  private readonly prepared = new Map<string, PreparedShare>();

  constructor(private readonly prisma: PrismaService) {}

  async prepare(dto: PrepareWhatsAppShareDto, user: ClerkUser | undefined): Promise<PreparedShareResponse> {
    if (!user?.userId) {
      throw new ForbiddenException({ error: 'Not signed in', code: 'FORBIDDEN' });
    }
    const allowed = ROLES_BY_TYPE[dto.documentType];
    if (!allowed || !user.role || !allowed.includes(user.role)) {
      throw new ForbiddenException({
        error: `Your role cannot share a ${dto.documentType.replace('_', ' ')}`,
        code: 'FORBIDDEN',
      });
    }

    const phone = validateWhatsAppPhone(dto.phoneNumber);
    if ('reason' in phone) {
      throw new UnprocessableEntityException({
        error: 'Invalid WhatsApp phone number',
        code: 'INVALID_PHONE',
        reason: phone.reason,
      });
    }

    const savedPhones = await this.authorizeDocument(dto.documentType, dto.documentId, dto.customerId);
    const phoneMatchesSaved = savedPhones.some((p) => toWhatsAppDigits(p) === phone.digits);

    this.sweep();
    const shareId = randomUUID();
    const now = Date.now();
    this.prepared.set(shareId, {
      userId: user.userId,
      documentType: dto.documentType,
      documentId: dto.documentId,
      expiresAt: now + SHARE_TTL_MS,
      reported: false,
    });

    this.logger.log(
      `prepared share=${shareId} type=${dto.documentType} doc=${dto.documentId} party=${dto.customerId} ` +
        `phone=${maskPhone(phone.digits)} savedNumber=${phoneMatchesSaved} user=${user.userId} ` +
        `(not sent — the user sends manually in WhatsApp)`,
    );

    return {
      shareId,
      phoneDigits: phone.digits,
      phoneMatchesSaved,
      preparedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SHARE_TTL_MS).toISOString(),
    };
  }

  /** Records how the extension workflow ended. Never means "sent". */
  reportOutcome(shareId: string, dto: ReportWhatsAppShareOutcomeDto, user: ClerkUser | undefined): void {
    const entry = this.prepared.get(shareId);
    if (!entry || entry.expiresAt < Date.now() || entry.reported) {
      throw new NotFoundException({ error: 'Share not found or expired', code: 'NOT_FOUND' });
    }
    if (entry.userId !== user?.userId) {
      throw new ForbiddenException({ error: 'This share belongs to another user', code: 'FORBIDDEN' });
    }
    entry.reported = true;
    const line =
      `outcome share=${shareId} type=${entry.documentType} doc=${entry.documentId} outcome=${dto.outcome}` +
      (dto.errorCode ? ` error=${dto.errorCode}` : '') +
      (dto.outcome === 'ready_for_manual_send' ? ' (PDF attached in WhatsApp, awaiting the user\'s manual Send)' : '') +
      ` user=${user.userId}`;
    if (dto.outcome === 'failed') this.logger.warn(line);
    else this.logger.log(line);
  }

  /**
   * Verifies the document exists and belongs to the given party.
   * Returns the party's saved phone numbers.
   */
  private async authorizeDocument(type: WhatsAppDocumentType, documentId: string, partyId: string): Promise<string[]> {
    const notFound = () =>
      new NotFoundException({ error: 'Document not found for this customer', code: 'NOT_FOUND' });

    switch (type) {
      case 'invoice': {
        const inv = await this.prisma.invoice.findUnique({
          where: { id: documentId },
          select: { clientId: true, client: { select: { phones: true } } },
        });
        if (!inv || inv.clientId !== partyId) throw notFound();
        return clientPhones(inv.client?.phones);
      }
      case 'delivery_receipt': {
        const order = await this.prisma.clientOrder.findUnique({
          where: { id: documentId },
          select: { clientId: true, client: { select: { phones: true } } },
        });
        if (!order || order.clientId !== partyId) throw notFound();
        return clientPhones(order.client?.phones);
      }
      case 'client_statement': {
        if (documentId !== partyId) throw notFound();
        const client = await this.prisma.client.findUnique({ where: { id: partyId }, select: { phones: true } });
        if (!client) throw notFound();
        return clientPhones(client.phones);
      }
      case 'supplier_statement': {
        if (documentId !== partyId) throw notFound();
        const supplier = await this.prisma.supplier.findUnique({
          where: { id: partyId },
          select: { contactPersons: true },
        });
        if (!supplier) throw notFound();
        return supplierPhones(supplier.contactPersons);
      }
      default:
        // Exhaustiveness guard — the DTO already restricts the type.
        throw new UnprocessableEntityException({
          error: `Unsupported document type; expected one of ${WHATSAPP_DOCUMENT_TYPES.join(', ')}`,
          code: 'VALIDATION_ERROR',
        });
    }
  }

  private sweep() {
    const now = Date.now();
    for (const [id, entry] of this.prepared) if (entry.expiresAt < now) this.prepared.delete(id);
  }
}

function clientPhones(json: unknown): string[] {
  return Array.isArray(json)
    ? json.map((p) => (p && typeof p === 'object' ? String((p as { number?: unknown }).number ?? '') : '')).filter(Boolean)
    : [];
}

function supplierPhones(json: unknown): string[] {
  return Array.isArray(json)
    ? json.map((p) => (p && typeof p === 'object' ? String((p as { phone?: unknown }).phone ?? '') : '')).filter(Boolean)
    : [];
}

/** Logs keep only the last 3 digits of a phone number. */
export function maskPhone(digits: string): string {
  return digits.length <= 3 ? '***' : `${'*'.repeat(digits.length - 3)}${digits.slice(-3)}`;
}
