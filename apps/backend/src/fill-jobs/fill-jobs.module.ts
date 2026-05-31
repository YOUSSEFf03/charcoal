import { Module } from '@nestjs/common';
import { FillJobsController } from './fill-jobs.controller';
import { FillJobsService } from './fill-jobs.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [FillJobsController],
  providers: [FillJobsService],
})
export class FillJobsModule {}
