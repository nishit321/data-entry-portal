import { Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { ExportsService } from './exports.service';
import { AnalyticsQueryDto } from '../analytics/dto/analytics-query.dto';
import { LevyAssessmentQueryDto } from '../levy/dto/levy-query.dto';
import { exportFilename } from './export-format';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { AUTHORITY_ROLES, OPERATOR_ROLES } from '../common/utils/data-scope.util';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * On-demand exports. Every route is scoped through the same service the screen uses, so a download
 * contains exactly what the caller can see — an operator's workbook holds only their own rows.
 */
@Controller('exports')
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Get('compliance.xlsx')
  @Roles(...OPERATOR_ROLES, ...AUTHORITY_ROLES)
  async compliance(
    @CurrentUser() user: AuthUser,
    @Query() query: AnalyticsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const buffer = await this.exports.complianceWorkbook(user, query);
    return this.send(res, buffer, XLSX_TYPE, exportFilename('compliance-summary', 'xlsx'));
  }

  @Get('levy.xlsx')
  @Roles(...OPERATOR_ROLES, ...AUTHORITY_ROLES)
  async levyWorkbook(
    @CurrentUser() user: AuthUser,
    @Query() query: LevyAssessmentQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const buffer = await this.exports.levyWorkbook(user, query);
    return this.send(res, buffer, XLSX_TYPE, exportFilename('levy-assessment', 'xlsx'));
  }

  @Get('levy.pdf')
  @Roles(...OPERATOR_ROLES, ...AUTHORITY_ROLES)
  async levyPdf(
    @CurrentUser() user: AuthUser,
    @Query() query: LevyAssessmentQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const buffer = await this.exports.levyPdf(user, query);
    return this.send(res, buffer, 'application/pdf', exportFilename('levy-assessment', 'pdf'));
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
