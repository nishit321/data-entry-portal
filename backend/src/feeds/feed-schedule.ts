import { AgreementStatus, FeedFrequency } from '@prisma/client';

/**
 * When a feed is due, and whether it is allowed to run at all (Q10, Phase 3).
 *
 * Two separate questions, kept separate on purpose. "Is it time?" is a timetable. "May we?" is the
 * data-sharing agreement, and that one is checked on every pull rather than when the feed was set
 * up — an agreement that lapses on Friday stops the data arriving on Friday.
 */

export interface FeedTimetable {
  frequency: FeedFrequency;
  /** Hour of day for a daily or weekly pull, 0-23. Ignored for an hourly one. */
  hour: number;
  /** Day of the week for a weekly pull, 1 = Monday. */
  dayOfWeek: number;
}

export interface AgreementWindow {
  status: AgreementStatus;
  startsAt: Date;
  endsAt: Date | null;
}

/** Monday is 1, matching how the day is stored; JavaScript puts Sunday at 0. */
function isoDayOfWeek(date: Date): number {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

/**
 * The start of the window `now` falls in, or null when the moment has not come round yet.
 *
 * The same shape the scheduled reports use, for the same reason: a run missed while the server was
 * down is caught up on the next tick rather than skipped, so an outage costs a late feed rather
 * than a lost one.
 */
export function feedWindowStart(now: Date, timetable: FeedTimetable): Date | null {
  if (timetable.frequency === FeedFrequency.HOURLY) {
    const due = new Date(now);
    due.setMinutes(0, 0, 0);
    return due;
  }

  if (timetable.frequency === FeedFrequency.WEEKLY) {
    const daysSince = (isoDayOfWeek(now) - timetable.dayOfWeek + 7) % 7;
    const due = new Date(now);
    due.setDate(due.getDate() - daysSince);
    due.setHours(timetable.hour, 0, 0, 0);
    return due <= now ? due : null;
  }

  const due = new Date(now);
  due.setHours(timetable.hour, 0, 0, 0);
  return due <= now ? due : null;
}

/** Whether the feed's window has come round and nothing has run since it opened. */
export function isFeedDue(now: Date, timetable: FeedTimetable, lastRunAt: Date | null): boolean {
  const due = feedWindowStart(now, timetable);
  if (due === null) return false;
  return lastRunAt === null || lastRunAt < due;
}

/**
 * Whether the agreement behind a feed is in force right now.
 *
 * An agreement that has not started, has ended, or was never signed is not a licence to collect
 * anything. Checked on every pull, because the whole point of Q10's "each feed is governed by a
 * formal agreement" is that the governance is live rather than filed.
 */
export function agreementInForce(agreement: AgreementWindow, now: Date): boolean {
  if (agreement.status !== AgreementStatus.ACTIVE) return false;
  if (agreement.startsAt > now) return false;
  if (agreement.endsAt !== null && agreement.endsAt < now) return false;
  return true;
}
