import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { MobileContainerTrackingController } from './mobile-container-tracking.controller';
import { MobileContainerTrackingService } from './mobile-container-tracking.service';

/**
 * Dedicated module for mobile-facing, read-only APIs — separate from
 * NotificationsModule (Phase C's device registration/push-sending concern)
 * even though both share the same MobileApiSecretGuard, imported here
 * rather than re-declared as a second provider registration.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [MobileContainerTrackingController],
  providers: [MobileContainerTrackingService],
})
export class MobileModule {}
