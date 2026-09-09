import { Module } from '@nestjs/common';
import { MobileDevicesController } from './mobile-devices.controller';
import { MobileDevicesAdminController } from './mobile-devices-admin.controller';
import { DeviceRegistryService } from './device-registry.service';
import { ContainerNotificationService } from './container-notification.service';
import { ExpoPushProvider } from './expo-push.provider';
import { PUSH_PROVIDER } from './push.provider';
import { MobileApiSecretGuard } from './mobile-api-secret.guard';

@Module({
  controllers: [MobileDevicesController, MobileDevicesAdminController],
  providers: [
    DeviceRegistryService,
    ContainerNotificationService,
    ExpoPushProvider,
    MobileApiSecretGuard,
    { provide: PUSH_PROVIDER, useExisting: ExpoPushProvider },
  ],
  // MobileApiSecretGuard is exported so other mobile-facing modules (e.g.
  // MobileModule, Phase D) can reuse the exact same guard instance/class
  // rather than re-declaring it — one credential mechanism, one place it's
  // registered.
  exports: [ContainerNotificationService, MobileApiSecretGuard],
})
export class NotificationsModule {}
