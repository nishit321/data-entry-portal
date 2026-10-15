import { PaymentKind } from '@prisma/client';

/**
 * Who owes what, and how much of it has arrived.
 *
 * Plain functions over plain data, apart from the service that fetches it, because this is the
 * arithmetic a regulator will be asked to defend and it should be testable without a database.
 */

/** One thing an operator owes: a period's levy, or the penalty on one compliance case. */
export interface Charge {
  kind: PaymentKind;
  /** `LEVY:<entityId>:<periodId>` or `PENALTY:<caseId>`. Payments are matched to charges by this. */
  key: string;
  entity: { id: string; name: string; type: string };
  period: { id: string; label: string; dueDate: Date };
  caseId: string | null;
  /** SSP. Zero for a charge that has been withdrawn but still has money recorded against it. */
  due: number;
}

export type ChargeStatus = 'UNPAID' | 'PART_PAID' | 'PAID' | 'OVERPAID';

export interface SettledCharge extends Charge {
  paid: number;
  outstanding: number;
  /** Money received beyond what was due. Kept, because the record has to match the bank. */
  overpaid: number;
  status: ChargeStatus;
}

/** Just enough of a payment to settle charges with. */
export interface PaymentLine {
  kind: PaymentKind;
  entityId: string;
  periodId: string | null;
  enforcementCaseId: string | null;
  amount: number;
  reversedAt: Date | null;
}

export function levyKey(entityId: string, periodId: string): string {
  return `LEVY:${entityId}:${periodId}`;
}

export function penaltyKey(caseId: string): string {
  return `PENALTY:${caseId}`;
}

export function keyOf(payment: PaymentLine): string {
  return payment.kind === PaymentKind.LEVY
    ? levyKey(payment.entityId, payment.periodId!)
    : penaltyKey(payment.enforcementCaseId!);
}

/** Cents, so that adding many two-decimal amounts never drifts the way floating point does. */
const cents = (ssp: number) => Math.round(ssp * 100);
const ssp = (c: number) => c / 100;

/**
 * Match payments to the charges they settle.
 *
 * A reversed payment counts for nothing: it is kept on record and shown, but the money it claimed
 * is not money that arrived. A payment with no matching charge is ignored here; the service makes
 * sure every charge that has payments against it is in the list, so none goes missing.
 */
export function settle(charges: Charge[], payments: PaymentLine[]): SettledCharge[] {
  const paidByKey = new Map<string, number>();
  for (const p of payments) {
    if (p.reversedAt) continue;
    const key = keyOf(p);
    paidByKey.set(key, (paidByKey.get(key) ?? 0) + cents(p.amount));
  }

  return charges.map((charge) => {
    const dueC = cents(charge.due);
    const paidC = paidByKey.get(charge.key) ?? 0;
    const status: ChargeStatus =
      paidC === 0 && dueC > 0
        ? 'UNPAID'
        : paidC > dueC
          ? 'OVERPAID'
          : paidC === dueC
            ? 'PAID'
            : 'PART_PAID';
    return {
      ...charge,
      paid: ssp(paidC),
      outstanding: ssp(Math.max(0, dueC - paidC)),
      overpaid: ssp(Math.max(0, paidC - dueC)),
      status,
    };
  });
}

export interface BalanceTotals {
  due: number;
  paid: number;
  outstanding: number;
  overpaid: number;
  /**
   * Of the money due, the share that has arrived. Null when nothing is due.
   *
   * Overpayment is not counted towards it. An operator who paid one levy twice over and another
   * not at all has not paid everything it owes, and a rate that reached 100% by netting the two
   * would say it had.
   */
  paymentRate: number | null;
  charges: number;
  chargesSettled: number;
}

export function totals(settled: SettledCharge[]): BalanceTotals {
  let due = 0;
  let paid = 0;
  let outstanding = 0;
  let overpaid = 0;
  let applied = 0;
  let chargesSettled = 0;
  for (const c of settled) {
    due += cents(c.due);
    paid += cents(c.paid);
    outstanding += cents(c.outstanding);
    overpaid += cents(c.overpaid);
    applied += Math.min(cents(c.paid), cents(c.due));
    if (c.status === 'PAID' || c.status === 'OVERPAID') chargesSettled += 1;
  }
  return {
    due: ssp(due),
    paid: ssp(paid),
    outstanding: ssp(outstanding),
    overpaid: ssp(overpaid),
    paymentRate: due > 0 ? applied / due : null,
    charges: settled.length,
    chargesSettled,
  };
}
