import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Webhook } from 'svix';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';

interface ClerkEmailAddress {
  id: string;
  email_address: string;
}

interface ClerkUserData {
  id: string;
  deleted?: boolean;
  email_addresses?: ClerkEmailAddress[];
  primary_email_address_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  public_metadata?: { role?: string } | null;
}

interface ClerkWebhookEvent {
  type: string;
  data: ClerkUserData;
}

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * POST /webhooks/clerk (no auth, no api/v1 prefix).
   * Verifies the Svix signature, then syncs user.created / user.updated /
   * user.deleted events.
   *
   * Always returns 200 for handled and explicitly-ignored event types so that
   * Svix does not retry indefinitely.
   */
  @ApiOperation({ summary: 'Clerk webhook receiver — syncs user lifecycle events' })
  @ApiResponse({ status: 200, description: 'Event received and processed' })
  @ApiResponse({ status: 400, description: 'Missing or invalid Svix signature headers' })
  @Public()
  @Post('clerk')
  @HttpCode(200)
  async handleClerk(
    @Req() req: Request,
    @Headers('svix-id') svixId: string,
    @Headers('svix-timestamp') svixTimestamp: string,
    @Headers('svix-signature') svixSignature: string,
  ) {
    const secret = this.configService.get<string>('CLERK_WEBHOOK_SECRET');
    if (!secret) {
      throw new BadRequestException({
        error: 'Webhook secret is not configured',
        code: 'CONSTRAINT_VIOLATION',
      });
    }

    if (!svixId || !svixTimestamp || !svixSignature) {
      throw new BadRequestException({
        error: 'Missing Svix signature headers',
        code: 'CONSTRAINT_VIOLATION',
      });
    }

    const payload =
      (req as Request & { rawBody?: Buffer }).rawBody?.toString('utf8') ??
      JSON.stringify(req.body);

    let event: ClerkWebhookEvent;
    try {
      const wh = new Webhook(secret);
      event = wh.verify(payload, {
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': svixSignature,
      }) as ClerkWebhookEvent;
    } catch {
      throw new BadRequestException({
        error: 'Invalid webhook signature',
        code: 'CONSTRAINT_VIOLATION',
      });
    }

    switch (event.type) {
      case 'user.created':
      case 'user.updated':
        await this.upsertUser(event.data);
        break;
      case 'user.deleted':
        await this.deleteUser(event.data);
        break;
      default:
        // Unhandled event types are acknowledged with 200 so Svix stops
        // retrying. Unknown types are not an error on our end.
        break;
    }

    return { received: true };
  }

  /**
   * Upsert a Clerk user into the local users table.
   *
   * Uses Prisma's upsert (single atomic statement keyed on the unique clerkId)
   * so that repeated deliveries of the same event — including concurrent
   * retries — are idempotent and never create duplicate rows.
   *
   * The update arm also resets deletedAt to null so that a re-invited user
   * (new user.created after a prior user.deleted) is fully restored.
   */
  private async upsertUser(data: ClerkUserData) {
    const email = this.resolvePrimaryEmail(data);
    const name =
      [data.first_name, data.last_name].filter(Boolean).join(' ').trim() ||
      email ||
      'Unknown';
    const role = this.resolveRole(data);

    await this.prisma.user.upsert({
      where: { clerkId: data.id },
      create: {
        clerkId: data.id,
        email:   email ?? `${data.id}@unknown.local`,
        name,
        role:    role ?? Role.worker,
      },
      update: {
        ...(email ? { email } : {}),
        name,
        ...(role ? { role } : {}),
        deletedAt: null,
      },
    });
  }

  /**
   * Soft-delete the local user record corresponding to a Clerk user.deleted
   * event. Sets deletedAt to the current timestamp without removing the row
   * or touching any referencing records.
   *
   * Uses updateMany so that:
   *   • A user absent from our DB is silently ignored (no NotFoundException).
   *   • A user already soft-deleted is left unchanged (where: { deletedAt: null }
   *     matches nothing, making repeat deliveries idempotent).
   *
   * Hard delete is intentionally avoided: the User row is referenced by FK
   * columns in containers, packing_sessions, stock_exits, payments,
   * cash_handovers, stock_adjustments, and more. Removing it would either
   * violate FK constraints or orphan audit records.
   */
  private async deleteUser(data: ClerkUserData) {
    await this.prisma.user.updateMany({
      where:  { clerkId: data.id, deletedAt: null },
      data:   { deletedAt: new Date() },
    });
  }

  private resolvePrimaryEmail(data: ClerkUserData): string | undefined {
    const emails = data.email_addresses ?? [];
    if (emails.length === 0) return undefined;
    if (data.primary_email_address_id) {
      const primary = emails.find(e => e.id === data.primary_email_address_id);
      if (primary) return primary.email_address;
    }
    return emails[0].email_address;
  }

  private resolveRole(data: ClerkUserData): Role | undefined {
    const raw = data.public_metadata?.role;
    if (raw && (Object.values(Role) as string[]).includes(raw)) {
      return raw as Role;
    }
    return undefined;
  }
}
