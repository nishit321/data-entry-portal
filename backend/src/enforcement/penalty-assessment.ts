/**
 * Turning a penalty schedule line into an amount (Phase 2, enforcement automation).
 *
 * Q3 is explicit that the penalty schedule is config-driven and supplied by NCA Legal & Licensing.
 * Nothing here decides what a contravention is worth; this is only the arithmetic that applies
 * whatever schedule an administrator has entered, kept pure so the figure on a case can be
 * reproduced and explained without reaching for the database.
 *
 * Three properties matter more than anything clever:
 *
 * - **A case is priced under the schedule in force when the contravention began**, not the one in
 *   force when someone happens to look at the case. A regulator that re-prices closed
 *   contraventions because the schedule changed afterwards will lose the argument.
 * - **Accrual stops when the default stops.** The day the return arrives, the meter stops, whether
 *   or not anyone has got around to closing the case.
 * - **A cap is a cap.** If the schedule sets a maximum, no amount of elapsed time exceeds it.
 */

/** A schedule line as the arithmetic needs it. Amounts are SSP, as everywhere else in the portal. */
export interface PenaltyTerms {
  /** Charged once, the moment the contravention is recorded. */
  fixedAmount: number;
  /** Charged for each further day the default continues. */
  dailyAmount: number;
  /** Ceiling on the total, or null when the schedule sets none. */
  maxAmount: number | null;
  /** Floor on the total, for a line stated as "a percentage, minimum X". */
  minAmount?: number | null;
  /** Percentage of audited annual revenue, for the tiers stated that way. */
  percentOfRevenue?: number | null;
}

export interface Assessment {
  amount: number;
  /** Days of continued default the amount rests on. */
  days: number;
  /** True when the cap bit, so the case can say so rather than showing an unexplained round figure. */
  capped: boolean;
  /** True when the floor lifted the figure, for the same reason. */
  floored: boolean;
  /**
   * Set when the line is a percentage of revenue and that revenue is not known yet.
   *
   * A QoS breach in Q1 is priced on the year's audited revenue, which arrives with the annual
   * return months later. The honest answer in between is not zero and not a guess — it is that the
   * amount cannot be stated, and why.
   */
  pending?: 'awaiting-audited-revenue';
}

/** Whole days between two instants, never negative. */
export function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  if (ms <= 0) return 0;
  return Math.floor(ms / 86_400_000);
}

/**
 * What a case is worth as at `asOf`.
 *
 * `startedAt` is the end of the grace window: the first moment the return was genuinely overdue.
 * `endedAt` is when the return arrived, if it has. Day zero carries the fixed amount alone, which
 * is the honest reading of "charged once when the contravention is recorded" — an operator who
 * files hours after the grace window closes has still contravened, but has not run a day late.
 */
export function assessPenalty(
  terms: PenaltyTerms,
  startedAt: Date,
  endedAt: Date | null,
  asOf: Date,
  /**
   * The operator's audited annual revenue in SSP, when it is known.
   *
   * Only consulted by a percentage line. `null` means the annual return has not been filed and
   * approved yet, which is the ordinary case for a contravention early in the year.
   */
  auditedAnnualRevenue: number | null = null,
): Assessment {
  const until = endedAt !== null && endedAt < asOf ? endedAt : asOf;
  const days = daysBetween(startedAt, until);

  /*
   * A percentage line and a per-day line are different instruments, not two halves of one sum.
   *
   * Tier 1 runs on time: a fixed charge plus so much a day. Tiers 2 and 3 run on size — a share of
   * what the operator earned that year, with a floor so that a small operator's breach is not
   * priced at almost nothing. Adding the two together would invent a penalty the Act does not
   * describe.
   */
  /*
   * A percentage that is not a finite number is not a percentage.
   *
   * Belt and braces after a NaN got this far once, from a caller that had not selected the column.
   * A wrong figure stated as a real one is the worst outcome available here, so the arithmetic
   * declines to treat rubbish as an instruction.
   */
  const raw = terms.percentOfRevenue;
  const percent = raw == null || !Number.isFinite(raw) ? null : raw;
  if (percent !== null) {
    if (auditedAnnualRevenue === null) {
      return {
        amount: 0,
        days,
        capped: false,
        floored: false,
        pending: 'awaiting-audited-revenue',
      };
    }
    return { ...bound(terms, (auditedAnnualRevenue * percent) / 100), days };
  }

  return { ...bound(terms, terms.fixedAmount + terms.dailyAmount * days), days };
}

/**
 * Put a raw figure inside the schedule's floor and cap, and say which of them moved it.
 *
 * A case that shows a round number with no explanation invites the argument that it was made up.
 * Saying "this is the minimum" or "this is the maximum" is the difference between a figure an
 * operator can check and one they can only dispute.
 */
function bound(terms: PenaltyTerms, raw: number): Omit<Assessment, 'days'> {
  const floored = terms.minAmount != null && raw < terms.minAmount;
  const withFloor = floored ? terms.minAmount! : raw;
  const capped = terms.maxAmount !== null && withFloor > terms.maxAmount;
  const amount = capped ? terms.maxAmount! : withFloor;
  // Two decimals, matching how every other monetary figure in the portal is stored and shown.
  return { amount: Math.round(amount * 100) / 100, capped, floored };
}
