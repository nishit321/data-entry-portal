import { formatReferenceNumber } from './reference-number.util';

describe('formatReferenceNumber', () => {
  it('zero-pads the sequence to six digits', () => {
    expect(formatReferenceNumber('SUB', 2026, 123)).toBe('NCA/SUB/2026/000123');
    expect(formatReferenceNumber('SUB', 2026, 1)).toBe('NCA/SUB/2026/000001');
  });

  it('keeps longer sequences intact', () => {
    expect(formatReferenceNumber('SUB', 2026, 1234567)).toBe('NCA/SUB/2026/1234567');
  });
});
