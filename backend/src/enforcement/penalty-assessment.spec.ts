import { assessPenalty, daysBetween, type PenaltyTerms } from './penalty-assessment';

const START = new Date('2026-01-20T00:00:00.000Z');
const day = (n: number) => new Date(START.getTime() + n * 86_400_000);

const TERMS: PenaltyTerms = { fixedAmount: 50_000, dailyAmount: 5_000, maxAmount: 200_000 };

describe('daysBetween', () => {
  it('counts whole days', () => {
    expect(daysBetween(START, day(3))).toBe(3);
  });

  it('does not count a part day', () => {
    expect(daysBetween(START, new Date(START.getTime() + 86_399_000))).toBe(0);
  });

  it('never goes negative when the dates are the wrong way round', () => {
    expect(daysBetween(day(5), START)).toBe(0);
  });
});

describe('assessPenalty', () => {
  it('charges the fixed amount alone on the day the default begins', () => {
    const a = assessPenalty(TERMS, START, null, START);
    expect(a).toEqual({ amount: 50_000, days: 0, capped: false });
  });

  it('adds the daily amount for each further day', () => {
    const a = assessPenalty(TERMS, START, null, day(4));
    expect(a.days).toBe(4);
    expect(a.amount).toBe(50_000 + 4 * 5_000);
  });

  it('stops accruing the day the return arrives', () => {
    // The return came on day 3; looking at the case on day 30 must not add 27 days of penalty.
    const a = assessPenalty(TERMS, START, day(3), day(30));
    expect(a.days).toBe(3);
    expect(a.amount).toBe(50_000 + 3 * 5_000);
  });

  it('keeps accruing while the return has still not arrived', () => {
    const a = assessPenalty(TERMS, START, null, day(10));
    expect(a.days).toBe(10);
  });

  it('respects the cap, and says that it bit', () => {
    // Uncapped this would be 50,000 + 100 × 5,000 = 550,000.
    const a = assessPenalty(TERMS, START, null, day(100));
    expect(a.amount).toBe(200_000);
    expect(a.capped).toBe(true);
    // The day count is still the real one, so the cap can be explained rather than just applied.
    expect(a.days).toBe(100);
  });

  it('leaves an uncapped schedule to run', () => {
    const a = assessPenalty({ ...TERMS, maxAmount: null }, START, null, day(100));
    expect(a.amount).toBe(550_000);
    expect(a.capped).toBe(false);
  });

  it('handles a schedule with no daily component', () => {
    const flat: PenaltyTerms = { fixedAmount: 75_000, dailyAmount: 0, maxAmount: null };
    expect(assessPenalty(flat, START, null, day(90)).amount).toBe(75_000);
  });

  it('handles a schedule with no fixed component', () => {
    const daily: PenaltyTerms = { fixedAmount: 0, dailyAmount: 1_000, maxAmount: null };
    expect(assessPenalty(daily, START, null, day(7)).amount).toBe(7_000);
  });

  it('is zero when the schedule charges nothing', () => {
    const none: PenaltyTerms = { fixedAmount: 0, dailyAmount: 0, maxAmount: null };
    expect(assessPenalty(none, START, null, day(30)).amount).toBe(0);
  });

  it('rounds to two decimals rather than carrying float drift', () => {
    const odd: PenaltyTerms = { fixedAmount: 0.1, dailyAmount: 0.2, maxAmount: null };
    expect(assessPenalty(odd, START, null, day(1)).amount).toBe(0.3);
  });

  it('does not backdate an assessment before the default began', () => {
    // Someone looking at the case before the grace window closed sees the fixed amount, not a
    // negative number of days.
    const a = assessPenalty(TERMS, day(5), null, START);
    expect(a.days).toBe(0);
    expect(a.amount).toBe(50_000);
  });
});
