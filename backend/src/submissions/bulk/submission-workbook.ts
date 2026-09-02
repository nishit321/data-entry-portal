import ExcelJS from 'exceljs';

/**
 * The offline-filling workbook (Q11).
 *
 * A questionnaire can run to eighty-odd fields, and operators file over a slow link around a
 * deadline. Rather than hold a browser session open through all of it, they download this sheet,
 * fill it offline, and upload it once.
 *
 * The **field key** is the join column: it is stable across template versions, visible to the
 * person filling the sheet, and meaningful in an error message. Row order and the label column are
 * for humans only — nothing is matched on them, so a re-sorted or re-worded sheet still loads.
 */

/** 1-based column positions. Fixed, because the parser must read a sheet a human has edited. */
const COLUMN = {
  section: 1,
  key: 2,
  label: 3,
  value: 4,
  unavailable: 5,
  reason: 6,
} as const;

/** The row the headers sit on; data starts on the next one. */
const HEADER_ROW = 6;

export interface WorkbookField {
  sectionTitle: string;
  key: string;
  label: string;
  unit?: string | null;
  currentValue?: string | null;
  isUnavailable?: boolean;
  unavailableReason?: string | null;
}

/** One parsed data row, before it is matched against the template. */
export interface ParsedRow {
  rowNumber: number;
  key: string;
  value: string | null;
  isUnavailable: boolean;
  unavailableReason: string | null;
}

/** A row that could not be used, with a reason written for the person who filled the sheet. */
export interface RejectedRow {
  rowNumber: number;
  key: string;
  reason: string;
}

const BRAND = 'FF2E5A88';

/** Read a cell as trimmed text, treating blanks and Excel's error values as empty. */
function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    // Formula cells carry { formula, result }; rich text carries { richText: [...] }.
    if ('result' in value && value.result !== undefined) return String(value.result).trim();
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText
        .map((t) => t.text)
        .join('')
        .trim();
    }
    if ('error' in value) return '';
    if (value instanceof Date) return value.toISOString().slice(0, 10);
  }
  return String(value).trim();
}

/** Accepts the spellings a person actually types for yes. */
function isYes(text: string): boolean {
  return ['yes', 'y', 'true', '1'].includes(text.trim().toLowerCase());
}

/** Build the workbook an operator downloads to fill in offline. */
export async function buildSubmissionWorkbook(opts: {
  templateName: string;
  periodLabel: string;
  entityName: string;
  fields: WorkbookField[];
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'NCA Data Collection Portal';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Return');

  sheet.addRow(['National Communication Authority, South Sudan']).font = { bold: true, size: 13 };
  sheet.addRow([`${opts.templateName}, ${opts.periodLabel}`]).font = { bold: true, size: 11 };
  sheet.addRow([opts.entityName]).font = { color: { argb: 'FF666666' }, size: 10 };
  sheet.addRow([
    'Fill in the Value column and upload this file. Do not change the Field key column: it is what matches each answer to its question.',
  ]).font = { color: { argb: 'FF666666' }, size: 10 };
  sheet.addRow([]);

  const header = sheet.addRow([
    'Section',
    'Field key',
    'Question',
    'Value',
    'Data unavailable',
    'Reason if unavailable',
  ]);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
  });
  header.height = 20;

  sheet.columns = [
    { width: 28 },
    { width: 26 },
    { width: 52 },
    { width: 18 },
    { width: 18 },
    { width: 40 },
  ];
  sheet.views = [{ state: 'frozen', ySplit: HEADER_ROW }];

  for (const field of opts.fields) {
    const row = sheet.addRow([
      field.sectionTitle,
      field.key,
      field.unit ? `${field.label} (${field.unit})` : field.label,
      field.currentValue ?? '',
      field.isUnavailable ? 'Yes' : '',
      field.unavailableReason ?? '',
    ]);
    // The three reference columns are locked visually by tone: they are not for editing.
    [COLUMN.section, COLUMN.key, COLUMN.label].forEach((c) => {
      row.getCell(c).font = { color: { argb: 'FF555555' } };
    });
    row.getCell(COLUMN.label).alignment = { wrapText: true, vertical: 'top' };
  }

  return Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
}

/**
 * Read a filled workbook back into rows. Structural problems (an unreadable file, a missing key
 * column) throw; per-row problems are returned so one bad line never rejects the whole file.
 */
export async function parseSubmissionWorkbook(
  buffer: Buffer,
): Promise<{ rows: ParsedRow[]; rejected: RejectedRow[] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('empty-workbook');

  const rows: ParsedRow[] = [];
  const rejected: RejectedRow[] = [];
  const seen = new Map<string, number>();

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= HEADER_ROW) return;

    const key = cellText(row.getCell(COLUMN.key));
    const value = cellText(row.getCell(COLUMN.value));
    const unavailable = isYes(cellText(row.getCell(COLUMN.unavailable)));
    const reason = cellText(row.getCell(COLUMN.reason));

    // A row with no key and nothing filled in is just spacing in the sheet.
    if (!key) {
      if (value || reason) {
        rejected.push({
          rowNumber,
          key: '',
          reason:
            'This row has an answer but no question reference, so we cannot tell where it belongs.',
        });
      }
      return;
    }

    const previous = seen.get(key);
    if (previous !== undefined) {
      rejected.push({
        rowNumber,
        key,
        reason: `This question also appears on row ${previous}. Keep one row per question.`,
      });
      return;
    }
    seen.set(key, rowNumber);

    if (unavailable && !reason) {
      rejected.push({
        rowNumber,
        key,
        reason: 'Marked as unavailable, but no reason was given.',
      });
      return;
    }

    // A row left entirely blank is "not answered yet", not an instruction to erase.
    if (!value && !unavailable) return;

    rows.push({
      rowNumber,
      key,
      value: unavailable ? null : value,
      isUnavailable: unavailable,
      unavailableReason: unavailable ? reason : null,
    });
  });

  return { rows, rejected };
}
