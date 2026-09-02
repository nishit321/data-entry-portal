import { Module } from '@nestjs/common';
import { PublicPortalController } from './public-portal.controller';
import { PublicPortalService } from './public-portal.service';
import { PublicIndicatorsController } from './public-indicators.controller';
import { PublicIndicatorsService } from './public-indicators.service';

/**
 * The public, unauthenticated view of the sector (Q4, Phase 2), and the allowlist that governs it.
 * The two live together so the rules about what may be published sit next to the code that
 * publishes it.
 */
@Module({
  controllers: [PublicPortalController, PublicIndicatorsController],
  providers: [PublicPortalService, PublicIndicatorsService],
  exports: [PublicPortalService],
})
export class PublicPortalModule {}
