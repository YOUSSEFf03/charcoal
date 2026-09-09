import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { MobileApiSecretGuard } from './mobile-api-secret.guard';
import { DeviceRegistryService } from './device-registry.service';
import { RegisterDeviceDto } from './dto/register-device.dto';

/**
 * The one minimal mobile-facing endpoint this phase introduces — device
 * push-token registration. Deliberately its own controller/module rather
 * than folded into ContainersController: the audit found no established
 * precedent in this codebase for mixing a differently-authenticated (shared
 * secret vs Clerk session) concern into an existing resource controller —
 * WebhooksController is the closest analog, and it is its own dedicated
 * controller for exactly this reason.
 *
 * @Public() skips the global JwtAuthGuard/RolesGuard (there is no Clerk
 * session on this path at all); MobileApiSecretGuard is the real
 * authorization here — see that guard's doc comment for the full
 * rationale. Excluded from the Swagger doc (which documents the
 * Clerk-authenticated surface) since @ApiBearerAuth() there would be
 * actively misleading about how this route is actually protected.
 */
@ApiExcludeController()
@Controller('mobile/devices')
@Public()
@UseGuards(MobileApiSecretGuard)
export class MobileDevicesController {
  constructor(private readonly deviceRegistry: DeviceRegistryService) {}

  @Post()
  register(@Body() dto: RegisterDeviceDto) {
    return this.deviceRegistry.register(dto);
  }
}
