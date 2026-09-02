import { addWorkingDays } from './working-days.util';

// Use local-time constructors so getDay() is deterministic. 2026-01-16 is a Friday.
const friday = () => new Date(2026, 0, 16);

describe('addWorkingDays', () => {
  it('skips the weekend', () => {
    // Fri + 1 working day → Mon 2026-01-19
    expect(addWorkingDays(friday(), 1).getTime()).toBe(new Date(2026, 0, 19).getTime());
  });

  it('adds five working days across a weekend', () => {
    // Fri + 5 working days → next Fri 2026-01-23 (Mon–Fri)
    expect(addWorkingDays(friday(), 5).getTime()).toBe(new Date(2026, 0, 23).getTime());
  });

  it('returns the same date for zero days', () => {
    expect(addWorkingDays(friday(), 0).getTime()).toBe(friday().getTime());
  });

  it('does not mutate the input date', () => {
    const d = friday();
    addWorkingDays(d, 3);
    expect(d.getTime()).toBe(new Date(2026, 0, 16).getTime());
  });
});
