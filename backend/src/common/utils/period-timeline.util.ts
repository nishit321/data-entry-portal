import { PeriodStatus } from '@prisma/client';
import { addWorkingDays } from './working-days.util';

/** Deadline phase of a reporting period relative to "now" (Q3) — computed, never stored. */
export type PeriodPhase = 'scheduled' | 'open' | 'grace' | 'overdue' | 'closed';

/** The moment the working-day grace window closes after the due date. */
export function graceEndsAt(dueDate: Date, graceDays: number): Date {
  return addWorkingDays(dueDate, graceDays);
}

/**
 * The phase a period is in. OPEN until the due date, then a working-day grace window
 * (returns still accepted but marked late), then overdue once grace ends. SCHEDULED and
 * CLOSED are driven by the lifecycle status, not the clock.
 */
export function periodPhase(
  status: PeriodStatus,
  dueDate: Date,
  graceDays: number,
  now = new Date(),
): PeriodPhase {
  if (status === PeriodStatus.CLOSED) return 'closed';
  if (status === PeriodStatus.SCHEDULED) return 'scheduled';
  if (now <= dueDate) return 'open';
  if (now <= graceEndsAt(dueDate, graceDays)) return 'grace';
  return 'overdue';
}
