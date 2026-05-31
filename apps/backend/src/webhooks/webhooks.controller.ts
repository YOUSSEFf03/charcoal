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
   * Verifies the Svix signature, then syncs user.created / user.updated.
   */
  @ApiOperation({ summary: 'Clerk webhook receiver — syncs user.created and user.updated events' })
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
        await this.upsertUser(event.data, true);
        break;
      case 'user.updated':
        await this.upsertUser(event.data, false);
        break;
      default:
        // Ignore unhandled event types.
        break;
    }

    return { received: true };
  }

  private async upsertUser(data: ClerkUserData, isCreate: boolean) {
    const email = this.resolvePrimaryEmail(data);
    const name =
      [data.first_name, data.last_name].filter(Boolean).join(' ').trim() ||
      email ||
      'Unknown';
    const role = this.resolveRole(data);

    const existing = await this.prisma.user.findUnique({
      where: { clerkId: data.id },
    });

    if (existing) {
      await this.prisma.user.update({
        where: { clerkId: data.id },
        data: {
          email: email ?? existing.email,
          name,
          ...(role ? { role } : {}),
        },
      });
      return;
    }

    if (!isCreate && !email) {
      // Nothing to create on an update for an unknown user without an email.
      return;
    }

    await this.prisma.user.create({
      data: {
        clerkId: data.id,
        email: email ?? `${data.id}@unknown.local`,
        name,
        role: role ?? Role.worker,
      },
    });
  }

  private resolvePrimaryEmail(data: ClerkUserData): string | undefined {
    const emails = data.email_addresses ?? [];
    if (emails.length === 0) {
      return undefined;
    }
    if (data.primary_email_address_id) {
      const primary = emails.find(
        (e) => e.id === data.primary_email_address_id,
      );
      if (primary) {
        return primary.email_address;
      }
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
