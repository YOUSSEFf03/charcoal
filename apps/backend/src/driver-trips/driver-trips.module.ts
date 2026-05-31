import { Module } from '@nestjs/common';
import { DriverTripsController } from './driver-trips.controller';
import { DriverTripsService } from './driver-trips.service';

@Module({
  controllers: [DriverTripsController],
  providers: [DriverTripsService],
  exports: [DriverTripsService],
})
export class DriverTripsModule {}
