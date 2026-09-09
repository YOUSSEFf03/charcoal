import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDeviceDto } from './dto/register-device.dto';

/** First and last few characters only — enough to tell two log lines apart during debugging without ever writing a usable token to a log. */
function redactToken(token: string): string {
  if (token.length <= 12) return '***';
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

/**
 * CRUD for registered mobile devices (DeviceToken). Deliberately has no
 * concept of a "user" — see DeviceToken's schema comment: the mobile app is
 * single-user and login-free, so there is no Clerk identity to associate a
 * device with.
 */
@Injectable()
export class DeviceRegistryService {
  private readonly logger = new Logger(DeviceRegistryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotent by construction: `token` is the natural key. Re-registering
   * the same device (app reinstall re-POSTing its token, or just the app
   * calling this on every launch) is a plain upsert — never creates a
   * duplicate row, and reactivates a device previously marked inactive
   * (e.g. Expo reported it invalid, then the app was reinstalled and now
   * legitimately holds that token's replacement... or, if Expo ever reissues
   * the identical token string, this is exactly the "it's valid again"
   * signal).
   */
  async register(dto: RegisterDeviceDto) {
    this.logger.log(`Registering device ${redactToken(dto.token)} (${dto.platform})`);
    const device = await this.prisma.deviceToken.upsert({
      where: { token: dto.token },
      update: {
        platform: dto.platform,
        appVersion: dto.appVersion,
        active: true,
        lastSeenAt: new Date(),
      },
      create: {
        token: dto.token,
        platform: dto.platform,
        appVersion: dto.appVersion,
      },
    });
    // Never return the token itself — the caller already has it; echoing it
    // back in the response body serves no purpose and is one more place it
    // could end up logged (e.g. by an HTTP access log capturing responses).
    return { id: device.id, platform: device.platform, active: device.active };
  }

  async findActiveTokens(): Promise<string[]> {
    const devices = await this.prisma.deviceToken.findMany({
      where: { active: true },
      select: { token: true },
    });
    return devices.map((d) => d.token);
  }

  /** Called only when a push provider definitively reports a token as invalid/unregistered — never for a transient send failure. */
  async deactivateTokens(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;
    this.logger.log(`Deactivating ${tokens.length} device(s) reported invalid by the push provider`);
    await this.prisma.deviceToken.updateMany({
      where: { token: { in: tokens } },
      data: { active: false },
    });
  }

  /**
   * Owner-only admin view (Settings → Container Mobile App). Deliberately
   * never selects `token` — there is no legitimate reason for it to leave
   * this service in an admin listing.
   */
  async listAll() {
    return this.prisma.deviceToken.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        platform: true,
        appVersion: true,
        active: true,
        createdAt: true,
        updatedAt: true,
        lastSeenAt: true,
      },
    });
  }

  /**
   * Revoke a device by its id (never its token — the admin UI never has the
   * token to begin with). Soft-revoke only, same as deactivateTokens: sets
   * `active: false` so it's skipped by findActiveTokens() on the next push,
   * never deleted. Idempotent — revoking an already-inactive device is a
   * harmless no-op, not an error; only a truly unknown id 404s.
   *
   * IMPORTANT SCOPE NOTE: this stops PUSH NOTIFICATIONS to the device. It
   * has no effect on that device's ability to call the read-only mobile API
   * (mobile-container-tracking.controller.ts) — that surface is guarded by
   * MobileApiSecretGuard, a single shared secret common to every install,
   * not a per-device credential. There is currently no mechanism to revoke
   * API access for one specific device without introducing per-device
   * credentials, which is out of scope here (see Settings UI copy).
   */
  async revoke(id: string) {
    const device = await this.prisma.deviceToken.findUnique({ where: { id } });
    if (!device) {
      throw new NotFoundException({ error: 'Device not found', code: 'NOT_FOUND' });
    }
    if (device.active) {
      this.logger.log(`Revoking device ${id} — push notifications will no longer be sent to it`);
      await this.prisma.deviceToken.update({ where: { id }, data: { active: false } });
    }
    return { id, active: false };
  }
}
