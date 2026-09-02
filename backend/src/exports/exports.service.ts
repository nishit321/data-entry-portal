import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { AnalyticsService } from '../analytics/analytics.service';
import { LevyService } from '../levy/levy.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { AnalyticsQueryDto } from '../analytics/dto/analytics-query.dto';
import { LevyAssessmentQueryDto } from '../levy/dto/levy-query.dto';
import { NUMBER_FORMAT, startSheet } from './export-format';
import { addNote, addSummary, addTable, createDocument } from './pdf-document';

/** How many recent periods the compliance workbook charts. */
const TREND_PERIODS = 12;

/** exceljs declares its own `Buffer extends ArrayBuffer`; convert it to a real Node buffer. */
async function toNodeBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
}

function percentLabel(value: number | null): string {
  return value === null ? 'Not applicable' : `${Math.round(value * 100)}%`;
}

function moneyLabel(value: number | null): string {
  return value === null
    ? 'Not calculated'
    : `SSP ${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * On-demand PDF/Excel exports of the analytics and levy views.
 *
 * Every export goes through the same scoped service the screen uses, rather than querying the
 * database again. That is deliberate: data segregation is decided once, in `AnalyticsService` and
 * `LevyService`, and an export can never quietly widen it — an operator downloading a workbook gets
 * exactly the rows they can see on screen.
 */
@Injectable()
export class ExportsService {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly levy: LevyService,
  ) {}

  /** Compliance workbook: a summary sheet plus the per-period filing trend. */
  async complianceWorkbook(user: AuthUser, query: AnalyticsQueryDto): Promise<Buffer> {
    const [summary, trends] = await Promise.all([
      this.analytics.summary(user, query),
      this.analytics.trends(user, { ...query, periods: TREND_PERIODS }),
    ]);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'NCA Data Collection Portal';
    workbook.created = new Date();

    const summarySheet = startSheet(
      workbook,
      'Summary',
      'Compliance summary',
      'Returns by status, filing timeliness, review pipeline, and open compliance cases.',
      [
        { header: 'Measure', key: 'measure', width: 34 },
        { header: 'Count', key: 'count', width: 14, numFmt: NUMBER_FORMAT.integer },
      ],
    );
    const rows: [string, number | string][] = [
      ['Returns, total', summary.submissions.total],
      ['Drafts in progress', summary.submissions.draft],
      ['Submitted, awaiting review', summary.submissions.submitted],
      ['Under review', summary.submissions.underReview],
      ['Approved', summary.submissions.approved],
      ['Sent back for changes', summary.submissions.rejected],
      ['Filed on time', summary.timeliness.onTime],
      ['Filed late', summary.timeliness.late],
      ['Waiting with the Checker', summary.pipeline.checker],
      ['Waiting with the Verifier', summary.pipeline.verifier],
      ['Waiting with the Approver', summary.pipeline.approver],
      ['Compliance cases, open', summary.compliance.open],
      ['Compliance cases, resolved', summary.compliance.resolved],
      ['Compliance cases, waived', summary.compliance.waived],
      ['Approval rate', percentLabel(summary.approvalRate)],
    ];
    rows.forEach((r) => summarySheet.addRow(r));

    const trendSheet = startSheet(
      workbook,
      'Filing trend',
      'Filing timeliness by period',
      'Returns filed for each reporting period, split into on time and late.',
      [
        { header: 'Period', key: 'period', width: 22 },
        { header: 'Due date', key: 'due', width: 14 },
        { header: 'Filed', key: 'filed', width: 10, numFmt: NUMBER_FORMAT.integer },
        { header: 'On time', key: 'onTime', width: 10, numFmt: NUMBER_FORMAT.integer },
        { header: 'Late', key: 'late', width: 10, numFmt: NUMBER_FORMAT.integer },
        { header: 'Approved', key: 'approved', width: 12, numFmt: NUMBER_FORMAT.integer },
        { header: 'Sent back', key: 'rejected', width: 12, numFmt: NUMBER_FORMAT.integer },
      ],
    );
    trends.periods.forEach((p) =>
      trendSheet.addRow([
        p.label,
        p.dueDate.toISOString().slice(0, 10),
        p.filed,
        p.onTime,
        p.late,
        p.approved,
        p.rejected,
      ]),
    );

    return toNodeBuffer(workbook);
  }

  /** Levy workbook: the per-operator assessment for a period, with the rate that produced it. */
  async levyWorkbook(user: AuthUser, query: LevyAssessmentQueryDto): Promise<Buffer> {
    const a = await this.levy.assessments(user, query);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'NCA Data Collection Portal';
    workbook.created = new Date();

    const sheet = startSheet(
      workbook,
      'Levy assessment',
      `Levy assessment${a.period ? `, ${a.period.label}` : ''}`,
      a.rate
        ? `Assessed at ${a.rate.ratePercent}% of approved revenue.`
        : 'No levy rate is configured for this period; revenue is shown without a levy.',
      [
        { header: 'Operator', key: 'operator', width: 34 },
        { header: 'Type', key: 'type', width: 10 },
        {
          header: 'Assessable revenue (SSP)',
          key: 'revenue',
          width: 24,
          numFmt: NUMBER_FORMAT.money,
        },
        { header: 'Levy due (SSP)', key: 'levy', width: 20, numFmt: NUMBER_FORMAT.money },
      ],
    );

    a.rows.forEach((r) =>
      sheet.addRow([r.entity.name, r.entity.type, r.assessableRevenue, r.levyDue]),
    );

    if (a.rows.length > 0) {
      const total = sheet.addRow(['Total', '', a.totals.totalRevenue, a.totals.totalLevyDue]);
      total.font = { bold: true };
    }

    return toNodeBuffer(workbook);
  }

  /** Levy assessment as a formal PDF notice, for issuing to an operator or filing internally. */
  async levyPdf(user: AuthUser, query: LevyAssessmentQueryDto): Promise<Buffer> {
    const a = await this.levy.assessments(user, query);

    const doc = createDocument(
      'Regulatory levy assessment',
      a.period
        ? `${a.period.label}${a.template ? `, ${a.template.name}` : ''}`
        : 'No period has been assessed yet',
    );

    addSummary(doc, [
      ['Reporting period', a.period?.label ?? 'None'],
      ['Rate applied', a.rate ? `${a.rate.ratePercent}%` : 'No rate configured'],
      ['Assessable revenue', moneyLabel(a.totals.totalRevenue)],
      ['Levy due', moneyLabel(a.totals.totalLevyDue)],
      ['Operators assessed', String(a.totals.operatorsAssessed)],
    ]);

    if (a.rows.length > 0) {
      addTable(
        doc,
        [
          { header: 'Operator', width: 200 },
          { header: 'Assessable revenue', width: 150, align: 'right' },
          { header: 'Levy due', width: 145, align: 'right' },
        ],
        a.rows.map((r) => [r.entity.name, moneyLabel(r.assessableRevenue), moneyLabel(r.levyDue)]),
      );
    }

    addNote(
      doc,
      a.levyBasisConfigured
        ? 'Figures are taken from approved returns for this period and are recalculated whenever a return is revised or re-approved. This document is a working assessment, not a demand for payment.'
        : 'No revenue field on this questionnaire is marked as the levy basis, so no revenue could be assessed. Mark the annual revenue field and generate this document again.',
    );

    return this.finish(doc);
  }

  /** Collect a pdfkit stream into a buffer so the controller can send it in one piece. */
  private finish(doc: PDFKit.PDFDocument): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    });
  }
}
