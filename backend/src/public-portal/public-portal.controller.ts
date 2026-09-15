import { Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { PublicPortalService } from './public-portal.service';
import { PublicExportsService } from './public-exports.service';
import { PublicIndicatorQueryDto } from './dto/public-query.dto';
import { Public } from '../common/decorators/public.decorator';
import { exportFilename } from '../exports/export-format';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * The open-data endpoints (Q4). No account, no token.
 *
 * Throttled a little more generously than the complaint form: these are read-only and cheap to
 * serve, but they are the one part of the portal an anonymous caller can hammer.
 */
@Controller('public')
export class PublicPortalController {
  constructor(
    private readonly portal: PublicPortalService,
    private readonly exports: PublicExportsService,
  ) {}

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

  /** The closed periods a reader may filter between. Labels and dates, nothing more. */
  @Public()
  @Get('periods')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  periods() {
    return this.portal.periods();
  }

  /*
   * The two downloads.
   *
   * Both take the same query as the page and both render what `indicators()` returned, so a file
   * holds exactly what the screen would have shown and nothing the screen would have withheld.
   *
   * Throttled well below the read routes. Generating a workbook costs more than serving JSON, and
   * these are reachable without an account, so the cheap routes and the expensive ones should not
   * share a budget.
   */
  @Public()
  @Get('indicators.xlsx')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async workbook(
    @Query() query: PublicIndicatorQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const buffer = await this.exports.workbook(query);
    return this.send(res, buffer, XLSX_TYPE, exportFilename('sector-figures', 'xlsx'));
  }

  @Public()
  @Get('indicators.pdf')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async pdf(
    @Query() query: PublicIndicatorQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const buffer = await this.exports.pdf(query);
    return this.send(res, buffer, 'application/pdf', exportFilename('sector-figures', 'pdf'));
  }

  private send(
    res: Response,
    buffer: Buffer,
    contentType: string,
    fileName: string,
  ): StreamableFile {
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': String(buffer.length),
    });
    return new StreamableFile(buffer);
  }
}
