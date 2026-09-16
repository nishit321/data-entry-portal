import { describe, expect, it } from 'vitest';
import { penaltyStanding } from './penalty-standing';
import type { EnforcementCase } from './types';

/**
 * The thirty days' notice the Act requires, as the screen has to read it.
 *
 * What makes this worth its own tests rather than an inline ternary: a case carries a real,
 * growing figure that the operator does not owe yet, and the two states look identical if nobody
 * distinguishes them. Showing an amount that is not yet payable as though it were is the one
 * mistake in this module with a legal consequence.
 */

const NOW = new Date('2026-09-16T10:00:00Z');

function makeCase(over: Partial<EnforcementCase> = {}): EnforcementCase {
  return {
    id: 'case-1',
    reason: 'LATE_SUBMISSION',
    status: 'OPEN',
    openedAt: '2026-09-01T00:00:00Z',
    createdAt: '2026-09-01T00:00:00Z',
    entity: { id: 'e1', name: 'Nile Telecom', type: 'MNO' },
    period: {
      id: 'p1',
      label: '2026 Q2',
      frequency: 'QUARTERLY',
      dueDate: '2026-07-31T00:00:00Z',
    },
    penaltyAmount: 250000,
    penaltyDays: 16,
    penaltyAssessedAt: null,
    remedyNoticeAt: '2026-09-01T00:00:00Z',
    remedyDueAt: '2026-10-01T00:00:00Z',
    ...over,
  } as EnforcementCase;
}

describe('penaltyStanding', () => {
  it('reports an amount inside the remedy period as accruing, not payable', () => {
    const standing = penaltyStanding(makeCase(), NOW);
    expect(standing.kind).toBe('accruing');
    // 16 September to 1 October.
    expect(standing.kind === 'accruing' && standing.daysLeft).toBe(15);
  });

  it('reports it as payable once the engine has assessed it', () => {
    // The engine stamps `penaltyAssessedAt` when the remedy period lapses unremedied, and that
    // stamp is the authority — not this module's arithmetic over the dates.
    const standing = penaltyStanding(makeCase({ penaltyAssessedAt: '2026-10-01T02:45:00Z' }), NOW);
    expect(standing.kind).toBe('payable');
  });

  it('reports it as payable once the notice has run out, even before the sweep catches up', () => {
    /*
     * The accrual job runs nightly, so between the notice lapsing and the sweep there is a window
     * where the date has passed and the stamp has not arrived. Calling that "not payable yet"
     * would tell an officer the wrong thing for up to a day.
     */
    const standing = penaltyStanding(makeCase({ remedyDueAt: '2026-09-15T00:00:00Z' }), NOW);
    expect(standing.kind).toBe('payable');
  });

  it('treats a case from before the remedy notice existed as payable', () => {
    // Cases opened before 3 September 2026 carry no due date. Reading that as "the thirty days
    // have not started" would grant a fresh remedy period to a default years old, which is the
    // opposite of what the rule is for.
    const standing = penaltyStanding(makeCase({ remedyDueAt: null }), NOW);
    expect(standing.kind).toBe('payable');
  });

  it('says nothing about a case no schedule line covers', () => {
    expect(penaltyStanding(makeCase({ penaltyAmount: null }), NOW).kind).toBe('not-priced');
    expect(penaltyStanding(makeCase({ penaltyAmount: undefined }), NOW).kind).toBe('not-priced');
  });

  it('leaves a closed case alone', () => {
    // The figure is frozen and the outcome column already says how it ended. Re-deciding whether
    // it was payable would put a second, contradictory story on the same row.
    for (const status of ['RESOLVED', 'WAIVED'] as const) {
      expect(penaltyStanding(makeCase({ status }), NOW).kind).toBe('settled');
    }
  });

  it('never counts down past zero', () => {
    // A due date one minute away is "today", not a negative number of days.
    const standing = penaltyStanding(makeCase({ remedyDueAt: '2026-09-16T10:00:30Z' }), NOW);
    expect(standing.kind === 'accruing' && standing.daysLeft).toBe(1);
  });
});
