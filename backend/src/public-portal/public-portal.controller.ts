import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PublicPortalService } from './public-portal.service';
import { PublicIndicatorQueryDto } from './dto/public-query.dto';
import { Public } from '../common/decorators/public.decorator';

/**
 * The open-data endpoints (Q4). No account, no token.
 *
 * Throttled a little more generously than the complaint form: these are read-only and cheap to
 * serve, but they are the one part of the portal an anonymous caller can hammer.
 */
@Controller('public')
export class PublicPortalController {
  constructor(private readonly portal: PublicPortalService) {}

  @Public()
  @Get('overview')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  overview() {
    return this.portal.overview();
  }

  @Public()
  @Get('indicators')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  indicators(@Query() query: PublicIndicatorQueryDto) {
    return this.portal.indicators(query);
  }

  @Public()
  @Get('complaints-summary')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  complaintsSummary() {
    return this.portal.complaintsSummary();
  }
}
