import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PublicAggregation } from '@prisma/client';
import { PublicPortalService, type PublicIndicatorReport } from './public-portal.service';
import { PublicIndicatorQueryDto } from './dto/public-query.dto';
import { AUTHORITY_NAME, NUMBER_FORMAT, startSheet } from '../exports/export-format';
import { addNote, addTable, createDocument } from '../exports/pdf-document';

/**
 * Downloads of the public figures (NCA, 15 September 2026).
 *
 * "Public Portal: ... enable export to PDF, Excel, and other formats."
 *
 * A file of its own rather than three more methods on `ExportsService`, and the reason is the
 * signature. Every method there begins `(user: AuthUser, ...)` and scopes its rows to that user; a
 * method with no user sitting among them is one refactor away from somebody adding the parameter
 * and the scoping along with it, or from somebody calling a public export from an authenticated
 * screen and getting more than the public should see.
 *
 * The rule that matters here is narrow and absolute: **an export renders the report object the
 * screen was given, and never queries for itself.** A withheld figure is withheld in the file. The
 * moment an export reaches for the database on its own, the disclosure threshold becomes a
 * property of one code path rather than of the data, and a download becomes the way around it.
 */
@Injectable()
export class PublicExportsService {
  constructor(private readonly portal: PublicPortalService) {}

  /** What every exported file says it is, under the Authority's name. */
  private subtitle(report: PublicIndicatorReport): string {
    const parts: string[] = ['Sector totals across licensed operators'];
    const { from, to, search } = report.filters;
    if (from || to) {
      const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : 'the earliest published');
      parts.push(`periods due ${day(from)} to ${to ? day(to) : 'the latest published'}`);
    }
    if (search) parts.push(`matching "${search}"`);
    return parts.join(', ');
  }

  /**
   * The closing note on every public file.
   *
   * It has to travel with the document, because a spreadsheet outlives the page it came from. A
   * reader who finds this file in a shared folder next year needs to know that a blank cell means
   * withheld rather than nil, or they will read it as zero and quote it.
   */
  private note(report: PublicIndicatorReport): string {
    return (
      `Figures are combined across operators. Individual operators' reported figures are ` +
      `commercially confidential and are not published. A period marked "Withheld" rests on ` +
      `fewer than ${report.threshold} operators, so publishing it would point at a named ` +
      `company. Withheld is not zero.`
    );
  }

  /** The cell a withheld period gets. A word, never a blank and never a nought. */
  private cell(value: number | null, withheld: boolean): string | number | null {
    if (withheld) return 'Withheld';
    return value;
  }

  async workbook(query: PublicIndicatorQueryDto): Promise<Buffer> {
    const report = await this.portal.indicators(query);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = AUTHORITY_NAME;

    /*
     * One row per indicator and one column per period, which is how the figures are read: across,
     * as a series. The alternative — a row per (indicator, period) pair — is easier to generate
     * and harder to use, and a spreadsheet nobody can pivot is a PDF with extra steps.
     */
    const columns = [
      { header: 'Figure', key: 'label', width: 34 },
      { header: 'Unit', key: 'unit', width: 14 },
      { header: 'Combined as', key: 'aggregation', width: 14 },
      ...report.periods.map((p) => ({
        header: p.label,
        key: `p_${p.id}`,
        width: 16,
        numFmt: NUMBER_FORMAT.money,
      })),
    ];

    const sheet = startSheet(
      workbook,
      'Sector figures',
      'Published sector figures',
      this.subtitle(report),
      columns,
    );

    for (const indicator of report.indicators) {
      sheet.addRow([
        indicator.label,
        indicator.unit ?? '',
        AGGREGATION_LABELS[indicator.aggregation],
        ...indicator.points.map((point) => this.cell(point.value, point.withheld)),
      ]);
    }

    /*
     * How many operators each figure rests on, on a sheet of its own.
     *
     * Published deliberately. It is the number that tells a reader whether a total covers the
     * sector or three companies in it, and withholding it would leave them unable to tell a
     * complete figure from a partial one. It names nobody: a count of contributors is not a list
     * of them, and the threshold means a published count is never low enough to narrow down.
     */
    const coverage = startSheet(
      workbook,
      'Coverage',
      'How many operators each figure rests on',
      this.subtitle(report),
      [
        { header: 'Figure', key: 'label', width: 34 },
        ...report.periods.map((p) => ({
          header: p.label,
          key: `c_${p.id}`,
          width: 16,
          numFmt: NUMBER_FORMAT.integer,
        })),
      ],
    );
    for (const indicator of report.indicators) {
      coverage.addRow([indicator.label, ...indicator.points.map((point) => point.contributors)]);
    }

    sheet.addRow([]);
    sheet.addRow([this.note(report)]);

    return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  }

  async pdf(query: PublicIndicatorQueryDto): Promise<Buffer> {
    const report = await this.portal.indicators(query);
    const doc = createDocument('Published sector figures', this.subtitle(report));

    if (report.indicators.length === 0) {
      addNote(doc, 'No published figures match this view.');
      return finish(doc);
    }

    /*
     * A page's worth of periods, and no more.
     *
     * A4 in portrait holds a label and about six columns before the numbers stop being legible,
     * and an unreadable table is worse than a shorter one. The most recent periods are the ones a
     * reader came for; the workbook carries the whole series for anyone who needs it, and the note
     * at the foot says so rather than leaving them to wonder what was cut.
     */
    const MAX_COLUMNS = 6;
    const shown = report.periods.slice(-MAX_COLUMNS);
    const firstShown = report.periods.length - shown.length;

    const labelWidth = 170;
    const columnWidth = Math.floor((495 - labelWidth) / Math.max(shown.length, 1));

    addTable(
      doc,
      [
        { header: 'Figure', width: labelWidth },
        ...shown.map((p) => ({ header: p.label, width: columnWidth, align: 'right' as const })),
      ],
      report.indicators.map((indicator) => [
        indicator.unit ? `${indicator.label} (${indicator.unit})` : indicator.label,
        ...indicator.points
          .slice(firstShown)
          .map((point) => (point.withheld ? 'Withheld' : formatFigure(point.value))),
      ]),
    );

    if (report.periods.length > shown.length) {
      addNote(
        doc,
        `Showing the ${shown.length} most recent periods of ${report.periods.length}. The Excel ` +
          'download carries the full series.',
      );
    }
    addNote(doc, this.note(report));

    return finish(doc);
  }
}

/** How each way of combining figures is worded to a reader who has never seen the enum. */
const AGGREGATION_LABELS: Record<PublicAggregation, string> = {
  [PublicAggregation.SUM]: 'Total',
  [PublicAggregation.AVERAGE]: 'Average',
  [PublicAggregation.COUNT]: 'Count',
};

/** Thousands separators and at most two decimals, so a column of figures lines up. */
function formatFigure(value: number | null): string {
  if (value === null) return '';
  return value.toLocaleString('en-GB', { maximumFractionDigits: 2 });
}

/**
 * Collect a pdfkit stream into a buffer.
 *
 * `end()` goes inside the promise, after the listeners are attached. pdfkit starts emitting the
 * moment it is ended, so ending first and listening afterwards loses the first chunks and produces
 * a file that opens as corrupt.
 */
function finish(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}
