// CSV export (FRONTEND_STANDARDS §3.11). A regulator reconciles this data offline and in
// spreadsheets; "read it off the screen" is not a workflow.
//
// One module so every export produces the same file: the same escaping, the same BOM, the same
// naming convention. Two details that look fussy and are not:
//
//  - The UTF-8 BOM. Without it Excel on Windows opens the file in the system codepage and any
//    non-ASCII name in the data arrives mangled.
//  - CRLF line endings, which is what the CSV spec says and what Excel is happiest with.

/** Hard ceiling on an export, so a filter that matches everything can't try to pull a million rows. */
export const EXPORT_ROW_LIMIT = 5000;

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

function escapeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  // A leading =, +, -, or @ makes a spreadsheet treat the cell as a formula. Prefixing an
  // apostrophe keeps exported data as data.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** UTF-8 byte-order mark. Written as an escape so it's visible in the source, not invisible. */
const BOM = String.fromCharCode(0xfeff);

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeCell(c.header)).join(',');
  const body = rows.map((row) => columns.map((c) => escapeCell(c.value(row))).join(','));
  return BOM + [header, ...body].join('\r\n');
}

/** Hand the file to the browser. Revoking the object URL afterwards keeps the blob from leaking. */
export function downloadCsv(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** `audit-log-2026-08-16.csv` — the subject and the day it was taken, so files stay tellable apart. */
export function exportFilename(subject: string, extension = 'csv'): string {
  const today = new Date().toISOString().slice(0, 10);
  return `${subject}-${today}.${extension}`;
}

/**
 * Page through a list endpoint to collect everything matching the current filters, stopping at
 * `EXPORT_ROW_LIMIT`. Returns what it collected and whether it hit the ceiling, so the caller can
 * say so rather than handing over a quietly truncated file.
 */
export async function collectForExport<T>(
  fetchPage: (page: number, pageSize: number) => Promise<{ data: T[]; meta: { hasNext: boolean } }>,
  pageSize = 100,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  let page = 1;

  for (;;) {
    const result = await fetchPage(page, pageSize);
    rows.push(...result.data);
    if (!result.meta.hasNext) return { rows, truncated: false };
    if (rows.length >= EXPORT_ROW_LIMIT)
      return { rows: rows.slice(0, EXPORT_ROW_LIMIT), truncated: true };
    page += 1;
  }
}
