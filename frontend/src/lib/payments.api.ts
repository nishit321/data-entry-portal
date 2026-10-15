import { api } from './api';
import { fileNameFromDisposition, saveBlob } from './download';
import type { EntityType, Paginated } from './types';

export type PaymentKind = 'LEVY' | 'PENALTY';
export type PaymentMethod = 'BANK_TRANSFER' | 'CHEQUE' | 'MOBILE_MONEY';
export type ChargeStatus = 'UNPAID' | 'PART_PAID' | 'PAID' | 'OVERPAID';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  BANK_TRANSFER: 'Bank transfer',
  CHEQUE: 'Cheque',
  MOBILE_MONEY: 'Mobile money',
};

export const CHARGE_STATUS_LABELS: Record<ChargeStatus, string> = {
  UNPAID: 'Unpaid',
  PART_PAID: 'Part paid',
  PAID: 'Paid',
  OVERPAID: 'Overpaid',
};

interface EntityRef {
  id: string;
  name: string;
  type: EntityType;
}

/** One thing an operator owes, and how much of it has arrived. */
export interface Charge {
  kind: PaymentKind;
  key: string;
  entity: EntityRef;
  period: { id: string; label: string; dueDate: string };
  caseId: string | null;
  due: number;
  paid: number;
  outstanding: number;
  overpaid: number;
  status: ChargeStatus;
}

export interface BalanceTotals {
  due: number;
  paid: number;
  outstanding: number;
  overpaid: number;
  /** Of the money due, the share that has arrived. Null when nothing is due. */
  paymentRate: number | null;
  charges: number;
  chargesSettled: number;
}

export interface Balances {
  totals: BalanceTotals;
  operators: (BalanceTotals & { entity: EntityRef })[];
  charges: Charge[];
}

interface Person {
  id: string;
  firstName: string;
  lastName: string;
}

export interface Payment {
  id: string;
  receiptNumber: string;
  kind: PaymentKind;
  amount: number;
  /** YYYY-MM-DD: the day the money arrived. */
  paidOn: string;
  method: PaymentMethod;
  bankReference: string;
  note: string | null;
  recordedAt: string;
  reversedAt: string | null;
  reversalReason: string | null;
  entity: EntityRef;
  period: { id: string; label: string } | null;
  enforcementCase: { id: string; period: { id: string; label: string } } | null;
  recordedBy: Person;
  reversedBy: Person | null;
}

export interface RecordPaymentInput {
  kind: PaymentKind;
  entityId: string;
  periodId?: string;
  enforcementCaseId?: string;
  amount: number;
  paidOn: string;
  method: PaymentMethod;
  bankReference: string;
  note?: string;
}

export interface PaymentFilters {
  entityId?: string;
  periodId?: string;
}

/** "Levy, 2026 Q1" or "Penalty, 2025 Q3": what a charge or a payment is for. */
export function chargeLabel(kind: PaymentKind, periodLabel: string | undefined): string {
  return `${kind === 'LEVY' ? 'Levy' : 'Penalty'}, ${periodLabel ?? 'unknown period'}`;
}

export const paymentsApi = {
  balances: (filters: PaymentFilters = {}) =>
    api.get<Balances>('/payments/balances', { params: filters }).then((r) => r.data),

  list: (params: PaymentFilters & { page: number; pageSize: number }) =>
    api.get<Paginated<Payment>>('/payments', { params }).then((r) => r.data),

  record: (input: RecordPaymentInput) => api.post<Payment>('/payments', input).then((r) => r.data),

  reverse: (id: string, reason: string) =>
    api.post<Payment>(`/payments/${id}/reverse`, { reason }).then((r) => r.data),

  /** Fetch the receipt and hand it to the browser under the name the server gave it. */
  downloadReceipt: async (payment: Payment) => {
    const res = await api.get<Blob>(`/payments/${payment.id}/receipt.pdf`, {
      responseType: 'blob',
    });
    saveBlob(
      res.data,
      fileNameFromDisposition(
        res.headers['content-disposition'],
        `receipt-${payment.receiptNumber.replace(/\//g, '-')}.pdf`,
      ),
    );
  },
};

export const paymentKeys = {
  all: ['payments'] as const,
  balances: (f: PaymentFilters) => ['payments', 'balances', f] as const,
  list: (f: PaymentFilters & { page: number; pageSize: number }) =>
    ['payments', 'list', f] as const,
};
