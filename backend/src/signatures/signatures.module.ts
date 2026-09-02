import { Module } from '@nestjs/common';
import { SignaturesController } from './signatures.controller';
import { SignaturesService } from './signatures.service';

/**
 * Certificate-based signatures (Q6, Phase 3). Exported so the submissions module can record a PKI
 * signature at the moment a return is filed.
 */
@Module({
  controllers: [SignaturesController],
  providers: [SignaturesService],
  exports: [SignaturesService],
})
export class SignaturesModule {}
