import { Module } from '@nestjs/common';
import { BagTypesController } from './bag-types.controller';
import { BagTypesService } from './bag-types.service';

@Module({
  controllers: [BagTypesController],
  providers: [BagTypesService],
  exports: [BagTypesService],
})
export class BagTypesModule {}
