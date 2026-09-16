import type { EnforcementCase } from './types';

/**
 * Where a penalty stands: accruing, payable, or settled (NCA, 16 September 2026).
 *
 * The Act requires thirty days' notice before any financial penalty, and NCA set out exactly how
 * that meets the accrual:
 *
 *   "From the original late date (after the grace window), but only assessed once the 30-day
 *    remedy period lapses unremedied. So nothing is payable during the 30 days, but a defaulter
 *    doesn't get a free month either."
 *
 * So a case can carry a real, growing figure that the operator does not owe yet. Until now the
 * screen showed the amount and nothing else, which reads as a demand — and a demand made before
 * the statutory notice has run is the one mistake in this module with a legal consequence rather
 * than a cosmetic one.
 *
 * One function, used by the table and by the dialog that waives a case, because those two saying
 * different things about the same figure would be worse than either saying nothing.
 */
export type PenaltyStanding =
  /** No schedule line covers this case, so there is no figure at all. */
  | { kind: 'not-priced' }
  /** Accruing, and not payable until the remedy period ends. */
  | { kind: 'accruing'; remedyEndsAt: string; daysLeft: number }
  /** The remedy period lapsed unremedied: the amount is now payable. */
  | { kind: 'payable' }
  /** The case is closed, so the figure is frozen at whatever it had reached. */
  | { kind: 'settled' };

/** Whole days from now until `when`, never below zero. */
function daysUntil(when: Date, now: Date): number {
  return Math.max(0, Math.ceil((when.getTime() - now.getTime()) / 86_400_000));
}

export function penaltyStanding(c: EnforcementCase, now = new Date()): PenaltyStanding {
  if (c.penaltyAmount === null || c.penaltyAmount === undefined) return { kind: 'not-priced' };

  // A closed case is history. Whether its figure was ever payable is not a question the screen
  // should reopen; the outcome column already says how it ended.
  if (c.status !== 'OPEN') return { kind: 'settled' };

  // The engine stamps this the moment the remedy period lapses, so it is the authoritative answer
  // and it is checked before any date arithmetic here.
  if (c.penaltyAssessedAt) return { kind: 'payable' };

  /*
   * No due date means this case predates the remedy notice, which cases opened before
   * 3 September 2026 do. The engine treats those as already lapsed rather than granting a fresh
   * thirty days years later, and the screen has to agree with the engine.
   */
  if (!c.remedyDueAt) return { kind: 'payable' };

  const due = new Date(c.remedyDueAt);
  if (Number.isNaN(due.getTime()) || due <= now) return { kind: 'payable' };

  return { kind: 'accruing', remedyEndsAt: c.remedyDueAt, daysLeft: daysUntil(due, now) };
}
