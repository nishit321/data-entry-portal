import { Module } from '@nestjs/common';
import { ReferenceDataService } from './reference-data.service';
import { ReferenceDataController } from './reference-data.controller';

@Module({
  controllers: [ReferenceDataController],
  providers: [ReferenceDataService],
  exports: [ReferenceDataService],
})
export class ReferenceDataModule {}
