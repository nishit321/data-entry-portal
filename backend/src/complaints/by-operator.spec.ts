import { ComplaintCategory, ComplaintStatus } from '@prisma/client';
import { ComplaintFact, byOperator, monthsEnding, summarise } from './by-operator';

const X = { id: 'x', name: 'Demo Telecom', type: 'MNO' };
const Y = { id: 'y', name: 'Nile Connect', type: 'ISP' };
const entities = new Map([
  [X.id, X],
  [Y.id, Y],
]);

function fact(over: Partial<ComplaintFact> = {}): ComplaintFact {
  return {
    aboutEntityId: X.id,
    category: ComplaintCategory.BILLING,
    status: ComplaintStatus.RECEIVED,
    createdAt: new Date('2026-09-10T00:00:00Z'),
    resolvedAt: null,
    ...over,
  };
}

const ended = (days: number, status: ComplaintStatus = ComplaintStatus.RESOLVED) =>
  fact({
    status,
    resolvedAt: new Date(new Date('2026-09-10T00:00:00Z').getTime() + days * 86_400_000),
  });

const MONTHS = monthsEnding(new Date('2026-10-15T00:00:00Z'), 3);

describe('the window of months', () => {
  it('ends in the given month and runs oldest first', () => {
    expect(MONTHS).toEqual(['2026-08', '2026-09', '2026-10']);
  });

  it('crosses a year boundary', () => {
    expect(monthsEnding(new Date('2026-01-20T00:00:00Z'), 2)).toEqual(['2025-12', '2026-01']);
  });
});

describe('one operator', () => {
  it('counts what was received, what is open, and what reached an end', () => {
    const s = summarise(X, [fact(), fact({ status: ComplaintStatus.IN_REVIEW }), ended(4)], MONTHS);
    expect(s).toMatchObject({ received: 3, open: 2, resolved: 1 });
    expect(s.resolutionRate).toBeCloseTo(1 / 3);
  });

  it('counts a closed case as ended, as the public page already does', () => {
    // One word, one meaning across the portal. The public summary has always counted both.
    const s = summarise(X, [ended(2, ComplaintStatus.CLOSED), ended(6)], MONTHS);
    expect(s.resolved).toBe(2);
  });

  it('takes the median days, so one case left open for a year does not describe the rest', () => {
    const s = summarise(X, [ended(2), ended(3), ended(4), ended(365)], MONTHS);
    expect(s.medianDaysToResolve).toBe(3.5);
  });

  it('has no rate and no typical time when there is nothing to measure', () => {
    const s = summarise(X, [], MONTHS);
    expect(s.resolutionRate).toBeNull();
    expect(s.medianDaysToResolve).toBeNull();
  });

  it('puts the commonest category first', () => {
    const s = summarise(
      X,
      [fact(), fact(), fact({ category: ComplaintCategory.COVERAGE })],
      MONTHS,
    );
    expect(s.byCategory[0]).toEqual({ category: ComplaintCategory.BILLING, count: 2 });
  });

  it('gives every month in the window a figure, including the quiet ones', () => {
    // A trend line with a missing month draws a straight line through a month that had nothing,
    // which reads as a month that had the average.
    const s = summarise(X, [fact()], MONTHS);
    expect(s.byMonth).toEqual([
      { month: '2026-08', count: 0 },
      { month: '2026-09', count: 1 },
      { month: '2026-10', count: 0 },
    ]);
  });
});

describe('every operator', () => {
  it('gives each operator its own line, busiest first', () => {
    const { operators } = byOperator(
      [fact(), fact({ aboutEntityId: Y.id }), fact({ aboutEntityId: Y.id })],
      entities,
      MONTHS,
    );
    expect(operators.map((o) => [o.entity!.name, o.received])).toEqual([
      ['Nile Connect', 2],
      ['Demo Telecom', 1],
    ]);
  });

  it('keeps complaints that named nobody, on a line of their own', () => {
    /*
     * Until the form asked, every complaint named nobody. Leaving them out would understate the
     * Authority's caseload by however many people did not know whose fault it was.
     */
    const { operators, unattributed } = byOperator(
      [fact(), fact({ aboutEntityId: null }), fact({ aboutEntityId: 'gone' })],
      entities,
      MONTHS,
    );
    expect(operators).toHaveLength(1);
    // An operator no longer on the register is counted here too, rather than vanishing.
    expect(unattributed.received).toBe(2);
    expect(unattributed.entity).toBeNull();
  });
});
