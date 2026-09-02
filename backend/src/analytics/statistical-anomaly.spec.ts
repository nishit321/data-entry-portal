import {
  DEFAULT_STATISTICAL,
  detectStatistical,
  median,
  medianAbsoluteDeviation,
  robustZScore,
  type StatisticalPoint,
} from './statistical-anomaly';

/** A quarterly series, oldest first. Everything but the newest figure counts as approved. */
function series(values: number[]): StatisticalPoint[] {
  return values.map((value, i) => ({
    periodId: `p${i}`,
    periodLabel: `Q${(i % 4) + 1}`,
    dueDate: new Date(2020, i * 3, 15),
    value,
    approved: i !== values.length - 1,
  }));
}

describe('medianAbsoluteDeviation', () => {
  it('measures the usual distance from the middle', () => {
    expect(medianAbsoluteDeviation([10, 10, 10, 10])).toBe(0);
    expect(medianAbsoluteDeviation([8, 9, 10, 11, 12])).toBe(1);
  });

  it('is not inflated by the outlier it is meant to help find', () => {
    const calm = [100, 101, 99, 100, 102];
    const withFreak = [...calm, 100_000];
    // A standard deviation would explode here, and the freak value would hide itself behind it.
    expect(medianAbsoluteDeviation(withFreak)).toBeLessThan(10);
    expect(medianAbsoluteDeviation(withFreak)).toBeGreaterThan(0);
  });

  it('handles an empty list', () => {
    expect(medianAbsoluteDeviation([])).toBe(0);
    expect(median([])).toBe(0);
  });
});

describe('robustZScore', () => {
  it('is zero for a figure sitting on the median', () => {
    expect(robustZScore(100, [98, 100, 102, 100])).toBe(0);
  });

  it('grows with distance measured in the series own noise', () => {
    const noisy = [50, 150, 50, 150, 100];
    const calm = [100, 100, 101, 99, 100];
    // The same absolute figure is unremarkable in a noisy series and extraordinary in a calm one.
    expect(robustZScore(200, noisy)!).toBeLessThan(robustZScore(200, calm)!);
  });

  it('reports a proportional move when the history never varies', () => {
    // A z-score is undefined here; something useful is reported rather than infinity.
    const z = robustZScore(200, [100, 100, 100, 100]);
    expect(z).toBeGreaterThan(0);
    expect(Number.isFinite(z)).toBe(true);
  });

  it('is zero when an unvarying history is matched exactly', () => {
    expect(robustZScore(100, [100, 100, 100])).toBe(0);
  });

  it('has nothing to say about an empty history', () => {
    expect(robustZScore(100, [])).toBeNull();
  });

  it('does not divide by zero when the history is all zeros', () => {
    expect(robustZScore(5, [0, 0, 0, 0])).toBeNull();
  });
});

describe('detectStatistical', () => {
  it('says nothing when there is too little history to know what normal is', () => {
    expect(detectStatistical(series([100, 102, 98, 101]))).toBeNull();
  });

  it('says nothing about a steady series', () => {
    expect(detectStatistical(series([100, 102, 98, 101, 99, 100, 101]))).toBeNull();
  });

  it('flags a figure that is far outside this series own noise', () => {
    const found = detectStatistical(series([100, 102, 98, 101, 99, 100, 500]));
    expect(found).not.toBeNull();
    expect(found!.kind).toBe('OUTLIER');
    expect(found!.value).toBe(500);
    expect(found!.expected).toBeCloseTo(100, 0);
    expect(found!.explanation).toContain('500');
  });

  it('leaves the same movement alone in a series that always moves that much', () => {
    // Swinging between 50 and 150 every quarter; 150 is business as usual here.
    const noisy = detectStatistical(series([50, 150, 60, 140, 55, 145, 150]));
    expect(noisy).toBeNull();

    // The identical figure in a calm series is not.
    const calm = detectStatistical(series([100, 100, 101, 99, 100, 100, 150]));
    expect(calm).not.toBeNull();
  });

  it('scores a far outlier above a near one', () => {
    const near = detectStatistical(series([100, 102, 98, 101, 99, 100, 115]));
    const far = detectStatistical(series([100, 102, 98, 101, 99, 100, 900]));
    expect(far!.severity).toBe('HIGH');
    expect(far!.score).toBeGreaterThan(near!.score);
  });

  it('grades a movement inside the usual noise below one far outside it', () => {
    // A series that swings widely: 130 is within its habits, 900 is not.
    const noisy = [100, 160, 90, 150, 95, 155, 130];
    const found = detectStatistical(series(noisy));
    expect(found).toBeNull();
  });

  it('sees a slow drift that no single period reveals', () => {
    // Eight quarters of steady growth. Not one step is a large move, and the total is a doubling.
    const found = detectStatistical(series([100, 110, 120, 132, 145, 160, 176, 194]));
    expect(found).not.toBeNull();
    expect(found!.kind).toBe('DRIFT');
    expect(found!.explanation).toContain('Risen');
    expect(found!.explanation).toContain('No single period');
  });

  it('sees a drift downwards too', () => {
    const found = detectStatistical(series([200, 180, 165, 150, 135, 120, 108, 96]));
    expect(found!.kind).toBe('DRIFT');
    expect(found!.explanation).toContain('Fallen');
  });

  it('treats a halving and a doubling as the same size of movement', () => {
    // Percentage change would call the fall (-50%) half the size of the rise (+100%) and flag only
    // the rise. A regulator needs both, and needs them scored alike.
    const doubling = detectStatistical(series([100, 105, 110, 130, 160, 190, 205, 210]));
    const halving = detectStatistical(series([210, 205, 190, 160, 130, 110, 105, 100]));
    expect(doubling!.kind).toBe('DRIFT');
    expect(halving!.kind).toBe('DRIFT');
    expect(halving!.score).toBeCloseTo(doubling!.score, 1);
  });

  it('flags a figure that breaks a seasonal pattern rather than the overall range', () => {
    // Q4 is always the big quarter. This year it is not, and the value is well inside the
    // series' overall range, so only a seasonal comparison can see it.
    const quarters = [100, 100, 100, 400, 100, 100, 100, 400, 100, 100, 100, 100];
    const found = detectStatistical(series(quarters));
    expect(found).not.toBeNull();
    expect(found!.kind).toBe('SEASONAL_BREAK');
    expect(found!.explanation).toContain('seasonal');
  });

  it('does not flag a seasonal peak that repeats as it always has', () => {
    const quarters = [100, 100, 100, 400, 100, 100, 100, 400, 100, 100, 100, 400];
    expect(detectStatistical(series(quarters))).toBeNull();
  });

  it('builds its view of normal from approved figures only', () => {
    const points = series([100, 102, 98, 101, 99, 100, 500]);
    // Nothing approved: there is no history to judge against, however many figures were filed.
    const unapproved = points.map((p) => ({ ...p, approved: false }));
    expect(detectStatistical(unapproved)).toBeNull();
  });

  it('scores relative to the threshold, so scores compare across questions', () => {
    const found = detectStatistical(series([100, 102, 98, 101, 99, 100, 500]));
    // A score of 1 is exactly at the threshold, so anything flagged is above 1.
    expect(found!.score).toBeGreaterThan(1);
  });

  it('returns one finding, not three descriptions of the same movement', () => {
    const found = detectStatistical(series([100, 110, 120, 132, 145, 160, 176, 900]));
    expect(found).not.toBeNull();
    expect(Array.isArray(found)).toBe(false);
    // The severe outlier beats the drift that is also present.
    expect(found!.kind).toBe('OUTLIER');
  });

  it('honours caller-supplied thresholds', () => {
    const strict = detectStatistical(series([100, 102, 98, 101, 99, 100, 115]), {
      ...DEFAULT_STATISTICAL,
      outlierZ: 1,
      severeZ: 2,
    });
    expect(strict).not.toBeNull();
  });

  it('returns nothing for an empty series', () => {
    expect(detectStatistical([])).toBeNull();
  });

  it('does not divide by zero when the early history is all zeros', () => {
    expect(() => detectStatistical(series([0, 0, 0, 0, 0, 0, 100]))).not.toThrow();
  });
});
