import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/decorators/public.decorator';

// Version-neutral: liveness stays at /api/health regardless of API version.
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Readiness: the app AND its dependencies (DB) are ready to serve traffic. */
  @Public()
  @Get()
  async check() {
    let database = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      timestamp: new Date().toISOString(),
    };
  }

  /** Liveness: the process is up. No dependency checks — for restart probes. */
  @Public()
  @Get('live')
  live() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
