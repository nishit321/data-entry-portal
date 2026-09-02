import { Module } from '@nestjs/common';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { StorageService } from './storage.service';

/** Supporting-file uploads (coverage/fibre maps, agent registers, documents) on submissions. */
@Module({
  controllers: [AttachmentsController],
  providers: [AttachmentsService, StorageService],
  exports: [StorageService],
})
export class FilesModule {}
