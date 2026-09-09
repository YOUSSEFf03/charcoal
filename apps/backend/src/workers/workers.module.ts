import { Module } from '@nestjs/common';
import { WorkersController } from './workers.controller';
import { WorkersService } from './workers.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  // SettingsModule — reuses SettingsService.getDailyWageRate() for the
  // "Daily wage" button (see logDailyWage()), the single authoritative
  // global daily-wage figure, never a second wage setting.
  imports: [SettingsModule],
  controllers: [WorkersController],
  providers: [WorkersService],
  exports: [WorkersService],
})
export class WorkersModule {}
