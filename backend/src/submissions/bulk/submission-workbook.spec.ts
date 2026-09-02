import ExcelJS from 'exceljs';
import { buildSubmissionWorkbook, parseSubmissionWorkbook } from './submission-workbook';

const FIELDS = [
  { sectionTitle: 'General', key: 'op_name', label: 'Operator name' },
  { sectionTitle: 'General', key: 'subs', label: 'Subscribers', unit: 'count' },
  { sectionTitle: 'Finance', key: 'revenue', label: 'Total revenue' },
];

const build = () =>
  buildSubmissionWorkbook({
    templateName: 'MNO Return',
    periodLabel: '2026 Q1',
    entityName: 'Acme Telecom',
    fields: FIELDS,
  });

/** Rewrite the Value / unavailable / reason cells of a built workbook, as a person would. */
async function fillAndSave(
  edits: Record<string, { value?: string; unavailable?: string; reason?: string }>,
  extraRows: (string | undefined)[][] = [],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load((await build()) as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 6) return;
    const key = String(row.getCell(2).value ?? '');
    const edit = edits[key];
    if (!edit) return;
    if (edit.value !== undefined) row.getCell(4).value = edit.value;
    if (edit.unavailable !== undefined) row.getCell(5).value = edit.unavailable;
    if (edit.reason !== undefined) row.getCell(6).value = edit.reason;
  });
  extraRows.forEach((cells) => sheet.addRow(cells));

  return Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
}

describe('buildSubmissionWorkbook', () => {
  it('produces a real workbook with a row per field', async () => {
    const buffer = await build();
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];

    // Five title rows, a header row, then one row per field.
    expect(sheet.rowCount).toBe(6 + FIELDS.length);
    expect(String(sheet.getRow(7).getCell(2).value)).toBe('op_name');
    // The unit is shown with the question so the operator knows what to enter.
    expect(String(sheet.getRow(8).getCell(3).value)).toBe('Subscribers (count)');
  });

  it('pre-fills what has already been answered', async () => {
    const buffer = await buildSubmissionWorkbook({
      templateName: 'T',
      periodLabel: 'P',
      entityName: 'E',
      fields: [
        { sectionTitle: 'S', key: 'a', label: 'A', currentValue: '42' },
        {
          sectionTitle: 'S',
          key: 'b',
          label: 'B',
          isUnavailable: true,
          unavailableReason: 'Meter faulty',
        },
      ],
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    expect(String(sheet.getRow(7).getCell(4).value)).toBe('42');
    expect(String(sheet.getRow(8).getCell(5).value)).toBe('Yes');
    expect(String(sheet.getRow(8).getCell(6).value)).toBe('Meter faulty');
  });
});

describe('parseSubmissionWorkbook', () => {
  it('reads back the values a person filled in', async () => {
    const buffer = await fillAndSave({
      op_name: { value: 'Acme Telecom' },
      subs: { value: '1000' },
    });
    const { rows, rejected } = await parseSubmissionWorkbook(buffer);

    expect(rejected).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.key === 'op_name')?.value).toBe('Acme Telecom');
    expect(rows.find((r) => r.key === 'subs')?.value).toBe('1000');
  });

  it('skips rows left blank rather than erasing them', async () => {
    const buffer = await fillAndSave({ op_name: { value: 'Acme' } });
    const { rows } = await parseSubmissionWorkbook(buffer);
    // Only the answered row comes back; the two blanks are "not answered yet".
    expect(rows.map((r) => r.key)).toEqual(['op_name']);
  });

  it('accepts the spellings people actually type for yes', async () => {
    for (const yes of ['Yes', 'y', 'TRUE', '1']) {
      const buffer = await fillAndSave({ subs: { unavailable: yes, reason: 'Not measured' } });
      const { rows } = await parseSubmissionWorkbook(buffer);
      const row = rows.find((r) => r.key === 'subs');
      expect(row?.isUnavailable).toBe(true);
      expect(row?.value).toBeNull();
      expect(row?.unavailableReason).toBe('Not measured');
    }
  });

  it('rejects an unavailable row with no reason', async () => {
    const buffer = await fillAndSave({ subs: { unavailable: 'Yes' } });
    const { rows, rejected } = await parseSubmissionWorkbook(buffer);
    expect(rows).toHaveLength(0);
    expect(rejected[0].key).toBe('subs');
    expect(rejected[0].reason).toMatch(/reason/i);
  });

  it('rejects a duplicated field key and names the row it clashes with', async () => {
    const buffer = await fillAndSave({ op_name: { value: 'First' } }, [
      ['General', 'op_name', 'Operator name', 'Second'],
    ]);
    const { rows, rejected } = await parseSubmissionWorkbook(buffer);
    expect(rows).toHaveLength(1);
    expect(rejected[0].key).toBe('op_name');
    expect(rejected[0].reason).toMatch(/also appears on row 7/);
  });

  it('rejects an answer typed on a row with no field key', async () => {
    const buffer = await fillAndSave({}, [['General', '', 'Something', 'orphan value']]);
    const { rejected } = await parseSubmissionWorkbook(buffer);
    expect(rejected[0].reason).toMatch(/no question reference/i);
  });

  it('throws on a file that is not a workbook at all', async () => {
    await expect(
      parseSubmissionWorkbook(Buffer.from('this is not a spreadsheet')),
    ).rejects.toThrow();
  });
});
