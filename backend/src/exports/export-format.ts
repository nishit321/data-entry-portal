import ExcelJS from 'exceljs';

/**
 * Shared formatting for every generated file, so exports look like one system rather than one
 * per screen: the same header treatment, the same number formats, the same title block naming
 * the Authority, the subject, and when the file was taken.
 */

/**
 * The Authority's name, as its own seal spells it: NATIONAL COMMUNICATION AUTHORITY, and beneath
 * that REPUBLIC OF SOUTH SUDAN.
 *
 * This is the name printed at the top of every workbook and PDF the portal produces, which is to
 * say the name on the documents that leave the building. It read "South Sudan" while the emails
 * read "Republic of South Sudan" and the printed sheets read "Communications" with an s.
 */
export const AUTHORITY_NAME = 'National Communication Authority, Republic of South Sudan';

/** Excel number formats. Money carries thousands separators and two decimals (SSP, §5). */
export const NUMBER_FORMAT = {
  money: '#,##0.00',
  integer: '#,##0',
  percent: '0.0%',
} as const;

export interface SheetColumn {
  header: string;
  key: string;
  width?: number;
  /** One of NUMBER_FORMAT, for numeric columns. */
  numFmt?: string;
}

/** An SSP amount as every generated document writes it, or a plain word where there is none. */
export function moneyLabel(value: number | null): string {
  return value === null
    ? 'Not calculated'
    : `SSP ${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** `levy-assessment-2026-08-21.xlsx` — the subject and the day it was taken. */
export function exportFilename(subject: string, extension: string): string {
  return `${subject}-${new Date().toISOString().slice(0, 10)}.${extension}`;
}

/** A readable timestamp for the title block. */
export function generatedAtLabel(now = new Date()): string {
  return now.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

/**
 * Start a sheet with a title block (subject, who it is for, when it was generated) and a styled
 * header row. Returns the sheet ready for `addRow`.
 */
export function startSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  title: string,
  subtitle: string,
  columns: SheetColumn[],
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(name);

  sheet.addRow([AUTHORITY_NAME]).font = { bold: true, size: 13 };
  sheet.addRow([title]).font = { bold: true, size: 11 };
  sheet.addRow([subtitle]).font = { color: { argb: 'FF666666' }, size: 10 };
  sheet.addRow([`Generated ${generatedAtLabel()}`]).font = {
    color: { argb: 'FF666666' },
    size: 10,
  };
  sheet.addRow([]);

  sheet.columns = [
    // Placeholder widths for the title rows above; the real columns follow.
    ...columns.map((c) => ({ key: c.key, width: c.width ?? 22 })),
  ];

  const header = sheet.addRow(columns.map((c) => c.header));
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E5A88' } };
    cell.alignment = { vertical: 'middle' };
  });
  header.height = 20;

  // Freeze everything above the first data row so headers stay visible while scrolling.
  sheet.views = [{ state: 'frozen', ySplit: header.number }];

  columns.forEach((c, i) => {
    if (c.numFmt) sheet.getColumn(i + 1).numFmt = c.numFmt;
  });

  return sheet;
}

/** Append a data row in column order, applying the banding used across every export. */
export function addDataRow(sheet: ExcelJS.Worksheet, values: (string | number | null)[]): void {
  sheet.addRow(values);
}
