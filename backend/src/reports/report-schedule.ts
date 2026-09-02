import { ReportFrequency } from '@prisma/client';

/**
 * Deciding whether a scheduled report is due (Phase 2).
 *
 * Kept pure and separate from the database so the timetable can be reasoned about and tested
 * without a clock or a connection. Two properties matter:
 *
 *  - **A report goes out once per window.** The job runs every hour, and a report that already went
 *    out this month must not go out again at the next tick. `lastRunAt` is what decides that, not a
 *    flag someone might forget to clear.
 *  - **A missed window is caught up, not skipped.** If the server was down at 07:00 on the 1st, the
 *    report should go at 08:00 rather than wait a month. Anything else means an outage silently
 *    costs a report, and nobody notices until a quarter-end review.
 */

export interface Timetable {
  frequency: ReportFrequency;
  /** Day of the month (1-28) for monthly and quarterly; day of the week (1 = Monday) for weekly. */
  dayOfPeriod: number;
  /** Hour of day, 0-23. */
  hour: number;
}

/** The months a quarterly report goes out in: the month after each quarter closes. */
const QUARTER_MONTHS = [0, 3, 6, 9];

/** Monday is 1 here, matching the way the day is stored; JavaScript puts Sunday at 0. */
function isoDayOfWeek(date: Date): number {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

/**
 * The start of the window `now` falls in: the moment this report was due.
 *
 * Returns null when `now` is before the due moment in its own window — the report is not late, it
 * simply has not come round yet.
 */
export function windowStart(now: Date, timetable: Timetable): Date | null {
  const { frequency, dayOfPeriod, hour } = timetable;

  if (frequency === ReportFrequency.WEEKLY) {
    const daysSince = (isoDayOfWeek(now) - dayOfPeriod + 7) % 7;
    const due = new Date(now);
    due.setDate(due.getDate() - daysSince);
    due.setHours(hour, 0, 0, 0);
    return due <= now ? due : null;
  }

  // Monthly and quarterly both key off a day of the month; quarterly only fires in four of them.
  const due = new Date(now);
  due.setDate(dayOfPeriod);
  due.setHours(hour, 0, 0, 0);

  if (frequency === ReportFrequency.QUARTERLY && !QUARTER_MONTHS.includes(due.getMonth())) {
    return null;
  }
  return due <= now ? due : null;
}

/**
 * Whether a report should be sent now.
 *
 * True when the due moment for the current window has passed and nothing has gone out since it.
 * `lastRunAt` of null means the report has never been sent, so the first due moment counts.
 */
export function isDue(now: Date, timetable: Timetable, lastRunAt: Date | null): boolean {
  const due = windowStart(now, timetable);
  if (due === null) return false;
  return lastRunAt === null || lastRunAt < due;
}
