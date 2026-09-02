import { Module } from '@nestjs/common';
import { GeoController } from './geo.controller';
import { GeoService } from './geo.service';

/**
 * Network geography (Phase 2): the structured site register and the map drawn from it, alongside
 * the agent locations the agent register already captures.
 */
@Module({
  controllers: [GeoController],
  providers: [GeoService],
  exports: [GeoService],
})
export class GeoModule {}
