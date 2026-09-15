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
    expect(a).toEqual({ amount: 50_000, days: 0, capped: false, floored: false });
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

/**
 * The three tiers NCA actually has, in their own figures (3 September 2026).
 *
 * Written from the schedule as it was given to us, not from the shape of the code — so that a
 * change to the arithmetic has to keep answering the Act rather than merely keep passing:
 *
 *   Tier 1  Reporting / admin      SSP 500,000 a day, capped at SSP 20m
 *   Tier 2  Licence / service      0.2% of audited annual revenue, minimum SSP 50m
 *   Tier 3  Serious or wilful      up to 10% of gross annual revenue
 */
describe('the schedule NCA gave us', () => {
  const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n));
  const START = day(0);

  describe('Tier 1 — a late return', () => {
    const TIER_1 = { fixedAmount: 0, dailyAmount: 500_000, maxAmount: 20_000_000 };

    it('charges by the day', () => {
      expect(assessPenalty(TIER_1, START, null, day(10)).amount).toBe(5_000_000);
    });

    it('stops at the cap, and says so', () => {
      // Forty days at half a million is twenty million, so the cap bites on the forty-first.
      const a = assessPenalty(TIER_1, START, null, day(60));
      expect(a.amount).toBe(20_000_000);
      expect(a.capped).toBe(true);
    });
  });

  describe('Tier 2 — quality of service', () => {
    // "a % of audited annual revenue with a floor, e.g. QoS 0.2% (min SSP 50m)"
    const TIER_2 = {
      fixedAmount: 0,
      dailyAmount: 0,
      maxAmount: null,
      minAmount: 50_000_000,
      percentOfRevenue: 0.2,
    };

    it('takes its share of the audited revenue', () => {
      // 0.2% of SSP 40bn is SSP 80m, comfortably clear of the floor.
      const a = assessPenalty(TIER_2, START, null, day(1), 40_000_000_000);
      expect(a.amount).toBe(80_000_000);
      expect(a.floored).toBe(false);
    });

    it('lifts a small operator to the floor, and says that is what happened', () => {
      /*
       * The reason the floor exists. 0.2% of SSP 5bn is SSP 10m — a fifth of the minimum — and a
       * penalty that scales to nothing for a small operator is not a deterrent. Saying the floor
       * bit is what lets the operator check the figure instead of only disputing it.
       */
      const a = assessPenalty(TIER_2, START, null, day(1), 5_000_000_000);
      expect(a.amount).toBe(50_000_000);
      expect(a.floored).toBe(true);
    });

    it('does not run on the clock', () => {
      // A share of the year's revenue is the same figure on day one and on day ninety. Charging it
      // per day as well would invent a penalty nobody wrote.
      const early = assessPenalty(TIER_2, START, null, day(1), 40_000_000_000);
      const late = assessPenalty(TIER_2, START, null, day(90), 40_000_000_000);
      expect(late.amount).toBe(early.amount);
    });

    it('states no amount at all until the audited revenue exists', () => {
      /*
       * The ordinary case, and the one worth getting right. A QoS breach in Q1 is priced on the
       * year's audited revenue, which arrives with the annual return months later. Zero would read
       * as "nothing owed" and a guess would be worse, so the case says why it has no figure yet.
       */
      const a = assessPenalty(TIER_2, START, null, day(1), null);
      expect(a.pending).toBe('awaiting-audited-revenue');
      expect(a.amount).toBe(0);
    });
  });

  it('treats a percentage that is not a number as no percentage at all', () => {
    /*
     * The failure this guards against actually happened. A caller selected three of the schedule's
     * five amount columns, so `percentOfRevenue` arrived as `undefined`, `Number(undefined)` gave
     * NaN, and NaN looked enough like a percentage to take that branch — pricing a real
     * contravention at zero and presenting it as a figure. A wrong number stated confidently is
     * the worst outcome available here.
     */
    const terms = { fixedAmount: 0, dailyAmount: 500_000, maxAmount: null };
    for (const percentOfRevenue of [NaN, undefined, null] as (number | undefined | null)[]) {
      const a = assessPenalty({ ...terms, percentOfRevenue }, day(0), null, day(4));
      expect(a.amount).toBe(2_000_000);
      expect(a.pending).toBeUndefined();
    }
  });

  describe('Tier 3 — serious or wilful conduct', () => {
    // "up to 10% of gross annual revenue". The Act's ceiling; what the Authority imposes within it
    // is a decision, and the schedule records the figure it decided on.
    const TIER_3 = {
      fixedAmount: 0,
      dailyAmount: 0,
      maxAmount: null,
      minAmount: null,
      percentOfRevenue: 10,
    };

    it('takes a tenth of the year', () => {
      expect(assessPenalty(TIER_3, START, null, day(1), 40_000_000_000).amount).toBe(4_000_000_000);
    });

    it('says nothing about suspending a licence, because an amount cannot', () => {
      /*
       * Tier 3's other half — suspension, cancellation, shortening the licence period — is not a
       * sum, and this module deliberately has no opinion on it. Putting a number on it would be
       * inventing something the Act does not express as one. It is recorded as a gap rather than
       * quietly approximated.
       */
      const a = assessPenalty(TIER_3, START, null, day(1), 40_000_000_000);
      expect(Object.keys(a).sort()).toEqual(['amount', 'capped', 'days', 'floored']);
    });
  });
});
