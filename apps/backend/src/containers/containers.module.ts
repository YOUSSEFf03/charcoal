import { Module } from '@nestjs/common';
import { ContainersController } from './containers.controller';
import { ContainersService } from './containers.service';
import { ContainerTrackingService } from './tracking/container-tracking.service';
import { ContainerTrackingScheduler } from './tracking/container-tracking.scheduler';
import { TraqoTrackingProvider } from './tracking/traqo-tracking.provider';
import { TRACKING_PROVIDER } from './tracking/container-tracking.provider';
import { TraqoAccountAllocationService } from './tracking/traqo-account-allocation.service';
import { TraqoKeyResolver } from './tracking/traqo-key-resolver.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [ContainersController],
  providers: [
    ContainersService,
    ContainerTrackingService,
    ContainerTrackingScheduler,
    TraqoTrackingProvider,
    TraqoAccountAllocationService,
    TraqoKeyResolver,
    { provide: TRACKING_PROVIDER, useExisting: TraqoTrackingProvider },
  ],
  exports: [ContainersService],
})
export class ContainersModule {}
