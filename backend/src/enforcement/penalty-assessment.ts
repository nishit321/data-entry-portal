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
}

export interface Assessment {
  amount: number;
  /** Days of continued default the amount rests on. */
  days: number;
  /** True when the cap bit, so the case can say so rather than showing an unexplained round figure. */
  capped: boolean;
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
): Assessment {
  const until = endedAt !== null && endedAt < asOf ? endedAt : asOf;
  const days = daysBetween(startedAt, until);

  const raw = terms.fixedAmount + terms.dailyAmount * days;
  const capped = terms.maxAmount !== null && raw > terms.maxAmount;
  const amount = capped ? terms.maxAmount! : raw;

  // Two decimals, matching how every other monetary figure in the portal is stored and shown.
  return { amount: Math.round(amount * 100) / 100, days, capped };
}
