import { PaymentKind } from '@prisma/client';
import { Charge, PaymentLine, levyKey, penaltyKey, settle, totals } from './balances';

const entity = { id: 'e1', name: 'Demo Telecom', type: 'MNO' };
const period = { id: 'p1', label: '2026 Q1', dueDate: new Date('2026-04-15') };

function levy(due: number, periodId = 'p1'): Charge {
  return {
    kind: PaymentKind.LEVY,
    key: levyKey('e1', periodId),
    entity,
    period: { ...period, id: periodId },
    caseId: null,
    due,
  };
}

function penalty(caseId: string, due: number): Charge {
  return { kind: PaymentKind.PENALTY, key: penaltyKey(caseId), entity, period, caseId, due };
}

function paid(amount: number, over: Partial<PaymentLine> = {}): PaymentLine {
  return {
    kind: PaymentKind.LEVY,
    entityId: 'e1',
    periodId: 'p1',
    enforcementCaseId: null,
    amount,
    reversedAt: null,
    ...over,
  };
}

describe('settling a charge', () => {
  it('is unpaid until money arrives', () => {
    const [c] = settle([levy(1000)], []);
    expect(c).toMatchObject({ paid: 0, outstanding: 1000, overpaid: 0, status: 'UNPAID' });
  });

  it('takes part payments and adds them up', () => {
    const [c] = settle([levy(1000)], [paid(300), paid(200)]);
    expect(c).toMatchObject({ paid: 500, outstanding: 500, status: 'PART_PAID' });
  });

  it('is paid when the money matches to the cent', () => {
    const [c] = settle([levy(1000.1)], [paid(1000), paid(0.1)]);
    // 1000 + 0.1 in floating point is 1000.1 by luck here and not by right elsewhere: the sum is
    // done in cents, so 0.1 + 0.2 kinds of error never decide whether a levy is paid.
    expect(c).toMatchObject({ outstanding: 0, status: 'PAID' });
  });

  it('records an overpayment as one, rather than tidying it away', () => {
    // The record has to match the bank. An operator who sent too much is owed the difference,
    // and a balance that quietly capped at "paid" would lose it.
    const [c] = settle([levy(1000)], [paid(1250)]);
    expect(c).toMatchObject({ paid: 1250, outstanding: 0, overpaid: 250, status: 'OVERPAID' });
  });

  it('ignores a reversed payment, which is money that did not arrive', () => {
    const [c] = settle([levy(1000)], [paid(1000, { reversedAt: new Date() })]);
    expect(c).toMatchObject({ paid: 0, outstanding: 1000, status: 'UNPAID' });
  });

  it('keeps each charge to its own payments', () => {
    // One payment for Q1 must not count towards Q2, and a penalty payment must not count towards
    // a levy. "Is the 2026 Q1 levy paid?" has to have its own answer.
    const settled = settle(
      [levy(1000, 'p1'), levy(1000, 'p2'), penalty('c1', 500)],
      [
        paid(1000, { periodId: 'p1' }),
        paid(500, { kind: PaymentKind.PENALTY, periodId: null, enforcementCaseId: 'c1' }),
      ],
    );
    expect(settled.map((c) => c.status)).toEqual(['PAID', 'UNPAID', 'PAID']);
  });

  it('shows money held against a charge that was withdrawn', () => {
    // A penalty paid and then waived is due nothing, and the money received for it still has to
    // appear somewhere: as an overpayment, owed back or carried.
    const [c] = settle(
      [penalty('c1', 0)],
      [paid(500, { kind: PaymentKind.PENALTY, periodId: null, enforcementCaseId: 'c1' })],
    );
    expect(c).toMatchObject({ due: 0, paid: 500, overpaid: 500, status: 'OVERPAID' });
  });
});

describe('totals', () => {
  it('adds up what is due, paid and outstanding', () => {
    const t = totals(
      settle(
        [levy(1000, 'p1'), levy(3000, 'p2')],
        [paid(1000, { periodId: 'p1' }), paid(500, { periodId: 'p2' })],
      ),
    );
    expect(t).toMatchObject({
      due: 4000,
      paid: 1500,
      outstanding: 2500,
      charges: 2,
      chargesSettled: 1,
    });
    expect(t.paymentRate).toBeCloseTo(1500 / 4000);
  });

  it('does not let an overpayment on one charge cover another', () => {
    /*
     * The rate is of money due that has arrived *against what it was due for*. One levy paid twice
     * over and another not at all is not a fully paid operator, and a rate that netted the two
     * would say 100% while a period's levy sat entirely unpaid.
     */
    const t = totals(
      settle([levy(1000, 'p1'), levy(1000, 'p2')], [paid(2000, { periodId: 'p1' })]),
    );
    expect(t.paid).toBe(2000);
    expect(t.outstanding).toBe(1000);
    expect(t.overpaid).toBe(1000);
    expect(t.paymentRate).toBeCloseTo(0.5);
  });

  it('has no rate when nothing is due', () => {
    expect(totals([]).paymentRate).toBeNull();
  });
});
