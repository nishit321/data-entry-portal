import { AgreementStatus, FeedFrequency } from '@prisma/client';
import { agreementInForce, feedWindowStart, isFeedDue, type FeedTimetable } from './feed-schedule';

const DAILY: FeedTimetable = { frequency: FeedFrequency.DAILY, hour: 3, dayOfWeek: 1 };
const WEEKLY: FeedTimetable = { frequency: FeedFrequency.WEEKLY, hour: 3, dayOfWeek: 1 };
const HOURLY: FeedTimetable = { frequency: FeedFrequency.HOURLY, hour: 0, dayOfWeek: 1 };

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0);

describe('feedWindowStart', () => {
  it('opens an hourly window at the top of the hour', () => {
    expect(feedWindowStart(at(2026, 3, 4, 9, 42), HOURLY)).toEqual(at(2026, 3, 4, 9));
  });

  it('is null before the hour a daily feed runs', () => {
    expect(feedWindowStart(at(2026, 3, 4, 2), DAILY)).toBeNull();
  });

  it('opens a daily window once the hour has come round', () => {
    expect(feedWindowStart(at(2026, 3, 4, 3), DAILY)).toEqual(at(2026, 3, 4, 3));
    expect(feedWindowStart(at(2026, 3, 4, 23), DAILY)).toEqual(at(2026, 3, 4, 3));
  });

  it('finds the most recent occurrence of the weekday for a weekly feed', () => {
    // 2026-03-04 is a Wednesday; the Monday before is 2026-03-02.
    expect(feedWindowStart(at(2026, 3, 4, 9), WEEKLY)).toEqual(at(2026, 3, 2, 3));
  });
});

describe('isFeedDue', () => {
  it('runs a feed that has never run', () => {
    expect(isFeedDue(at(2026, 3, 4, 3), DAILY, null)).toBe(true);
  });

  it('does not run before the hour', () => {
    expect(isFeedDue(at(2026, 3, 4, 2), DAILY, null)).toBe(false);
  });

  it('does not run twice in the same window', () => {
    const ran = at(2026, 3, 4, 3);
    expect(isFeedDue(at(2026, 3, 4, 9), DAILY, ran)).toBe(false);
  });

  it('runs again the next day', () => {
    expect(isFeedDue(at(2026, 3, 5, 3), DAILY, at(2026, 3, 4, 3))).toBe(true);
  });

  it('catches up a window the server was down for', () => {
    // Due at 03:00, nothing ran, and it is now 09:00. Late, not lost.
    expect(isFeedDue(at(2026, 3, 4, 9), DAILY, at(2026, 3, 3, 3))).toBe(true);
  });

  it('runs an hourly feed once an hour', () => {
    const ranAtNine = at(2026, 3, 4, 9, 5);
    expect(isFeedDue(at(2026, 3, 4, 9, 50), HOURLY, ranAtNine)).toBe(false);
    expect(isFeedDue(at(2026, 3, 4, 10, 1), HOURLY, ranAtNine)).toBe(true);
  });

  it('holds a weekly feed through the week', () => {
    const monday = at(2026, 3, 2, 3);
    expect(isFeedDue(at(2026, 3, 5, 9), WEEKLY, monday)).toBe(false);
    expect(isFeedDue(at(2026, 3, 9, 3), WEEKLY, monday)).toBe(true);
  });
});

describe('agreementInForce', () => {
  const now = at(2026, 6, 15);

  it('allows an active agreement inside its dates', () => {
    expect(
      agreementInForce(
        { status: AgreementStatus.ACTIVE, startsAt: at(2026, 1, 1), endsAt: at(2027, 1, 1) },
        now,
      ),
    ).toBe(true);
  });

  it('allows an open-ended active agreement', () => {
    expect(
      agreementInForce(
        { status: AgreementStatus.ACTIVE, startsAt: at(2026, 1, 1), endsAt: null },
        now,
      ),
    ).toBe(true);
  });

  it('refuses one that has not started', () => {
    expect(
      agreementInForce(
        { status: AgreementStatus.ACTIVE, startsAt: at(2026, 12, 1), endsAt: null },
        now,
      ),
    ).toBe(false);
  });

  it('refuses one that has run out', () => {
    expect(
      agreementInForce(
        { status: AgreementStatus.ACTIVE, startsAt: at(2025, 1, 1), endsAt: at(2026, 5, 1) },
        now,
      ),
    ).toBe(false);
  });

  it.each([AgreementStatus.DRAFT, AgreementStatus.EXPIRED, AgreementStatus.TERMINATED])(
    'refuses a %s agreement even inside its dates',
    (status) => {
      expect(agreementInForce({ status, startsAt: at(2026, 1, 1), endsAt: null }, now)).toBe(false);
    },
  );
});
