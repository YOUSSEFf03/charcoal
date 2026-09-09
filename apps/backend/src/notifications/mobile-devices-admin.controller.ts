import { Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { DeviceRegistryService } from './device-registry.service';

/**
 * Owner-only admin view of registered mobile devices (Settings → Container
 * Mobile App). Distinct from MobileDevicesController (`/mobile/devices`,
 * @Public() + MobileApiSecretGuard, used by the app itself to register a
 * push token) — this one goes through the normal Clerk-authenticated
 * surface, same pattern as TraqoAccountsController for its own owner-only
 * admin panel. Never selects or returns a device's push token — see
 * DeviceRegistryService.listAll()/revoke().
 */
@ApiTags('Mobile Devices (Admin)')
@ApiBearerAuth()
@Controller('mobile-devices')
@Roles('owner')
export class MobileDevicesAdminController {
  constructor(private readonly deviceRegistry: DeviceRegistryService) {}

  @ApiOperation({ summary: 'List registered mobile devices — never includes the push token' })
  @Get()
  findAll() {
    return this.deviceRegistry.listAll();
  }

  @ApiOperation({ summary: 'Revoke a device (stops push notifications to it; does not affect the shared mobile API secret)' })
  @ApiResponse({ status: 404, description: 'Device not found' })
  @Patch(':id/revoke')
  revoke(@Param('id', ParseUUIDPipe) id: string) {
    return this.deviceRegistry.revoke(id);
  }
}
