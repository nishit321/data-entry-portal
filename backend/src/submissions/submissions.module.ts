import { Module } from '@nestjs/common';
import { SignaturesModule } from '../signatures/signatures.module';
import { SubmissionsService } from './submissions.service';
import { SubmissionsController } from './submissions.controller';
import { BulkUploadService } from './bulk/bulk-upload.service';
import { FilesModule } from '../files/files.module';

@Module({
  // Revising a rejected return copies its attachments forward, so we use the storage service.
  imports: [SignaturesModule, FilesModule],
  controllers: [SubmissionsController],
  providers: [SubmissionsService, BulkUploadService],
  exports: [SubmissionsService],
})
export class SubmissionsModule {}
