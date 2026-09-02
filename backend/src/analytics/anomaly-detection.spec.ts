import { DEFAULT_DETECTION, detectAnomaly, median, type SeriesPoint } from './anomaly-detection';

/** Build a series from plain numbers, oldest first, all approved unless stated. */
function series(values: number[], opts: { latestApproved?: boolean } = {}): SeriesPoint[] {
  return values.map((value, i) => ({
    periodId: `p${i}`,
    periodLabel: `2026 Q${i + 1}`,
    dueDate: new Date(2026, i * 3, 15),
    value,
    // The newest figure is the one under examination; it does not form part of its own baseline.
    approved: i === values.length - 1 ? (opts.latestApproved ?? false) : true,
  }));
}

describe('median', () => {
  it('takes the middle of an odd-length list', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('averages the middle pair of an even-length list', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('is unmoved by a single freak value, unlike a mean', () => {
    const normal = [100, 100, 100, 100];
    const withOutlier = [100, 100, 100, 100_000];
    expect(median(withOutlier)).toBe(median(normal));
    // The mean would have been dragged to 25,075 — which is the whole reason for using a median.
    const mean = withOutlier.reduce((a, b) => a + b, 0) / withOutlier.length;
    expect(mean).toBeGreaterThan(1000);
  });

  it('returns zero for an empty list rather than NaN', () => {
    expect(median([])).toBe(0);
  });
});

describe('detectAnomaly', () => {
  it('says nothing about a steady series', () => {
    expect(detectAnomaly(series([100, 105, 98, 102, 101]))).toBeNull();
  });

  it('ignores movement inside the threshold', () => {
    // 140 against a baseline of 100 is 40%, under the 50% default.
    expect(detectAnomaly(series([100, 100, 100, 100, 140]))).toBeNull();
  });

  it('flags a spike, and explains it in figures a person can check', () => {
    const found = detectAnomaly(series([100, 100, 100, 100, 400]));
    expect(found).not.toBeNull();
    expect(found!.kind).toBe('SPIKE');
    expect(found!.baseline).toBe(100);
    expect(found!.changePercent).toBe(300);
    expect(found!.explanation).toContain('300%');
    expect(found!.explanation).toContain('100');
  });

  it('flags a drop', () => {
    const found = detectAnomaly(series([1000, 1000, 1000, 1000, 200]));
    expect(found!.kind).toBe('DROP');
    expect(found!.changePercent).toBe(80);
    expect(found!.explanation).toMatch(/^Fell/);
  });

  it('grades a severe movement higher than a moderate one', () => {
    const moderate = detectAnomaly(series([100, 100, 100, 100, 200]));
    const severe = detectAnomaly(series([100, 100, 100, 100, 500]));
    expect(moderate!.severity).toBe('MEDIUM');
    expect(severe!.severity).toBe('HIGH');
  });

  it('treats a fall to zero as its own signal, not as an ordinary 100% drop', () => {
    const found = detectAnomaly(series([500, 500, 500, 500, 0]));
    expect(found!.kind).toBe('NEW_ZERO');
    expect(found!.severity).toBe('HIGH');
    expect(found!.explanation).toContain('zero');
  });

  it('handles a figure appearing after a run of zeros without dividing by zero', () => {
    const found = detectAnomaly(series([0, 0, 0, 0, 250]));
    expect(found!.kind).toBe('SPIKE');
    expect(found!.baseline).toBe(0);
    // No percentage is claimed, because there is nothing to take a percentage of.
    expect(found!.changePercent).toBeNull();
    expect(found!.explanation).toContain('previously been zero');
  });

  it('says nothing when a series is all zeros', () => {
    expect(detectAnomaly(series([0, 0, 0, 0, 0]))).toBeNull();
  });

  it('marks a first report rather than pretending to compare it', () => {
    const found = detectAnomaly(series([9000]));
    expect(found!.kind).toBe('FIRST_REPORT');
    expect(found!.baseline).toBeNull();
    expect(found!.baselineSize).toBe(0);
  });

  it('stays quiet when there is too little history to judge against', () => {
    // One prior approved figure is below the two-period minimum.
    expect(detectAnomaly(series([100, 900]))).toBeNull();
  });

  it('builds the baseline only from approved figures', () => {
    // Three filed figures, but only the first is approved, so there is no usable baseline.
    const points: SeriesPoint[] = [
      {
        periodId: 'a',
        periodLabel: 'Q1',
        dueDate: new Date(2026, 0, 15),
        value: 100,
        approved: true,
      },
      {
        periodId: 'b',
        periodLabel: 'Q2',
        dueDate: new Date(2026, 3, 15),
        value: 100,
        approved: false,
      },
      {
        periodId: 'c',
        periodLabel: 'Q3',
        dueDate: new Date(2026, 6, 15),
        value: 900,
        approved: false,
      },
    ];
    expect(detectAnomaly(points)).toBeNull();
  });

  it('only looks back as far as the window', () => {
    // An ancient run of 1s must not drag the baseline away from the recent 100s.
    const found = detectAnomaly(series([1, 1, 1, 100, 100, 100, 100, 400]));
    expect(found!.baseline).toBe(100);
    expect(found!.baselineSize).toBe(DEFAULT_DETECTION.window);
  });

  it('orders by due date, so a late filing is still judged in sequence', () => {
    const points: SeriesPoint[] = [
      {
        periodId: 'c',
        periodLabel: 'Q3',
        dueDate: new Date(2026, 6, 15),
        value: 400,
        approved: false,
      },
      {
        periodId: 'a',
        periodLabel: 'Q1',
        dueDate: new Date(2026, 0, 15),
        value: 100,
        approved: true,
      },
      {
        periodId: 'b',
        periodLabel: 'Q2',
        dueDate: new Date(2026, 3, 15),
        value: 100,
        approved: true,
      },
    ];
    const found = detectAnomaly(points);
    // Q3 is the newest by date despite arriving first in the array.
    expect(found!.value).toBe(400);
    expect(found!.baseline).toBe(100);
  });

  it('returns nothing for an empty series', () => {
    expect(detectAnomaly([])).toBeNull();
  });

  it('honours a caller-supplied threshold', () => {
    const gentle = detectAnomaly(series([100, 100, 100, 100, 130]), {
      ...DEFAULT_DETECTION,
      thresholdPercent: 20,
    });
    expect(gentle!.changePercent).toBe(30);
  });
});
