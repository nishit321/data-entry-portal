import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { FilesModule } from '../files/files.module';

/** Licence and certificate repository with versioning and expiry alerts. */
@Module({
  imports: [FilesModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
