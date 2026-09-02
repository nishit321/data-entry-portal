import { ReportFrequency } from '@prisma/client';
import { isDue, windowStart, type Timetable } from './report-schedule';

const MONTHLY: Timetable = {
  frequency: ReportFrequency.MONTHLY,
  dayOfPeriod: 1,
  hour: 7,
};
const WEEKLY: Timetable = {
  frequency: ReportFrequency.WEEKLY,
  dayOfPeriod: 1, // Monday
  hour: 7,
};
const QUARTERLY: Timetable = {
  frequency: ReportFrequency.QUARTERLY,
  dayOfPeriod: 15,
  hour: 7,
};

/** Local time, so the arithmetic matches how the schedule is written and read. */
const at = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h, 0, 0, 0);

describe('windowStart', () => {
  it('is null before the due hour on the due day', () => {
    expect(windowStart(at(2026, 3, 1, 6), MONTHLY)).toBeNull();
  });

  it('is the due moment once the hour has come round', () => {
    expect(windowStart(at(2026, 3, 1, 7), MONTHLY)).toEqual(at(2026, 3, 1, 7));
  });

  it('stays on the same window later in the month', () => {
    expect(windowStart(at(2026, 3, 20, 15), MONTHLY)).toEqual(at(2026, 3, 1, 7));
  });

  it('finds the most recent occurrence of the weekday for a weekly report', () => {
    // 2026-03-04 is a Wednesday; the Monday before it is 2026-03-02.
    expect(windowStart(at(2026, 3, 4, 9), WEEKLY)).toEqual(at(2026, 3, 2, 7));
  });

  it('is null on the due weekday before the hour', () => {
    expect(windowStart(at(2026, 3, 2, 6), WEEKLY)).toBeNull();
  });

  it('fires a quarterly report only in the months after a quarter closes', () => {
    expect(windowStart(at(2026, 1, 20), QUARTERLY)).toEqual(at(2026, 1, 15, 7));
    expect(windowStart(at(2026, 4, 20), QUARTERLY)).toEqual(at(2026, 4, 15, 7));
    // February and March are inside a quarter, so nothing is due.
    expect(windowStart(at(2026, 2, 20), QUARTERLY)).toBeNull();
    expect(windowStart(at(2026, 3, 20), QUARTERLY)).toBeNull();
  });
});

describe('isDue', () => {
  it('sends a report that has never gone out', () => {
    expect(isDue(at(2026, 3, 1, 7), MONTHLY, null)).toBe(true);
  });

  it('does not send before the due moment', () => {
    expect(isDue(at(2026, 3, 1, 6), MONTHLY, null)).toBe(false);
  });

  it('does not send twice in the same window', () => {
    const sent = at(2026, 3, 1, 7);
    expect(isDue(at(2026, 3, 1, 8), MONTHLY, sent)).toBe(false);
    expect(isDue(at(2026, 3, 28, 23), MONTHLY, sent)).toBe(false);
  });

  it('sends again in the next window', () => {
    expect(isDue(at(2026, 4, 1, 7), MONTHLY, at(2026, 3, 1, 7))).toBe(true);
  });

  it('catches up a window the server was down for', () => {
    // Due at 07:00 on the 1st, nothing sent, and it is now the 3rd. The report is late, not lost.
    expect(isDue(at(2026, 3, 3, 9), MONTHLY, at(2026, 2, 1, 7))).toBe(true);
  });

  it('treats a run from before the window as not yet sent', () => {
    expect(isDue(at(2026, 3, 1, 9), MONTHLY, at(2026, 3, 1, 6))).toBe(true);
  });

  it('holds a quarterly report through the months in between', () => {
    const sent = at(2026, 1, 15, 7);
    expect(isDue(at(2026, 2, 15, 9), QUARTERLY, sent)).toBe(false);
    expect(isDue(at(2026, 3, 31, 9), QUARTERLY, sent)).toBe(false);
    expect(isDue(at(2026, 4, 15, 7), QUARTERLY, sent)).toBe(true);
  });

  it('sends a weekly report once a week', () => {
    const monday = at(2026, 3, 2, 7);
    expect(isDue(monday, WEEKLY, null)).toBe(true);
    expect(isDue(at(2026, 3, 5, 9), WEEKLY, monday)).toBe(false);
    expect(isDue(at(2026, 3, 9, 7), WEEKLY, monday)).toBe(true);
  });
});
