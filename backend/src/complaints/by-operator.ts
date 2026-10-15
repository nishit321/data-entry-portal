import { ComplaintCategory, ComplaintStatus } from '@prisma/client';
import { median } from '../common/utils/median.util';

/**
 * Complaints counted per operator (NCA, October 2026: "complaints filtered and grouped per
 * operator, with categories, status, resolution rates and trends").
 *
 * Plain functions over plain rows, so the counting that would be quoted at an operator can be
 * tested without a database.
 *
 * "Resolved" means what it already means on the public page: the case reached an end, whether the
 * Authority recorded it as resolved or closed. Two pages using one word for two things would be
 * worse than either definition.
 */

export interface ComplaintFact {
  aboutEntityId: string | null;
  category: ComplaintCategory;
  status: ComplaintStatus;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface EntityRef {
  id: string;
  name: string;
  type: string;
}

export interface OperatorComplaints {
  /** Null for complaints whose filer did not name an operator. */
  entity: EntityRef | null;
  received: number;
  open: number;
  resolved: number;
  /** Of those received, the share that reached an end. Null when none were received. */
  resolutionRate: number | null;
  /** Typical days from filing to an end, over those that ended. Null when none have. */
  medianDaysToResolve: number | null;
  byCategory: { category: ComplaintCategory; count: number }[];
  /** Received per calendar month, oldest first, one entry for every month in the window. */
  byMonth: { month: string; count: number }[];
}

const ENDED: ComplaintStatus[] = [ComplaintStatus.RESOLVED, ComplaintStatus.CLOSED];

/** `2026-10` for a date, in UTC, so a month boundary is the same wherever the server runs. */
export function monthOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** The months of a window ending in `end`'s month, oldest first. */
export function monthsEnding(end: Date, count: number): string[] {
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1));
    months.push(monthOf(d));
  }
  return months;
}

export function summarise(
  entity: EntityRef | null,
  facts: ComplaintFact[],
  months: string[],
): OperatorComplaints {
  const ended = facts.filter((f) => ENDED.includes(f.status));
  const days = ended
    .filter((f) => f.resolvedAt)
    .map((f) => (f.resolvedAt!.getTime() - f.createdAt.getTime()) / 86_400_000)
    // A clock set wrong once should not produce a case resolved before it was filed.
    .filter((d) => d >= 0);

  const categories = new Map<ComplaintCategory, number>();
  for (const f of facts) categories.set(f.category, (categories.get(f.category) ?? 0) + 1);

  const perMonth = new Map(months.map((m) => [m, 0]));
  for (const f of facts) {
    const m = monthOf(f.createdAt);
    if (perMonth.has(m)) perMonth.set(m, perMonth.get(m)! + 1);
  }

  return {
    entity,
    received: facts.length,
    open: facts.length - ended.length,
    resolved: ended.length,
    resolutionRate: facts.length > 0 ? ended.length / facts.length : null,
    medianDaysToResolve: days.length > 0 ? Math.round(median(days) * 10) / 10 : null,
    byCategory: [...categories.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category)),
    byMonth: [...perMonth.entries()].map(([month, count]) => ({ month, count })),
  };
}

/**
 * One line per operator that was complained about, most complaints first, and a last line for
 * complaints that named nobody.
 *
 * The unattributed line is kept rather than dropped. Before the complaint form asked, every
 * complaint was unattributed, and a table that quietly left them out would understate the work by
 * however many people did not know whose fault it was.
 */
export function byOperator(
  facts: ComplaintFact[],
  entities: Map<string, EntityRef>,
  months: string[],
): { operators: OperatorComplaints[]; unattributed: OperatorComplaints } {
  const grouped = new Map<string, ComplaintFact[]>();
  const unattributed: ComplaintFact[] = [];
  for (const f of facts) {
    if (f.aboutEntityId && entities.has(f.aboutEntityId)) {
      grouped.set(f.aboutEntityId, [...(grouped.get(f.aboutEntityId) ?? []), f]);
    } else {
      unattributed.push(f);
    }
  }
  const operators = [...grouped.entries()]
    .map(([id, rows]) => summarise(entities.get(id)!, rows, months))
    .sort((a, b) => b.received - a.received || a.entity!.name.localeCompare(b.entity!.name));
  return { operators, unattributed: summarise(null, unattributed, months) };
}

/**
 * Fewest complaints an operator needs in the window before its figures are published.
 *
 * A resolution rate taken over three complaints moves by a third with every case, and printing it
 * beside a name would be unfair to the operator and no use to a reader. Below this the operator is
 * counted in a "too few to compare" line instead. Ten is a judgement, written down so it can be
 * changed deliberately rather than drifting.
 */
export const MIN_COMPLAINTS_TO_PUBLISH = 10;
