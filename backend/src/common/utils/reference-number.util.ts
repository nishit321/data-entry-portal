/**
 * The single canonical reference-number format for human-referable records
 * (VALIDATION_SPEC / CODING_STANDARDS §5). Every module that mints one calls this
 * — do not scatter formats. Example: NCA/SUB/2026/000123.
 */
export function formatReferenceNumber(kind: string, year: number, seq: number): string {
  return `NCA/${kind}/${year}/${String(seq).padStart(6, '0')}`;
}
