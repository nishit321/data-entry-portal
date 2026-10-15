import { describe, expect, it } from 'vitest';
import {
  changeDirection,
  comparePeriods,
  complianceRate,
  formatPointChange,
  formatRate,
  formatRelativeChange,
  onTimeRate,
} from './period-comparison';
import type { AnalyticsTrendPoint } from './types';

function point(over: Partial<AnalyticsTrendPoint>): AnalyticsTrendPoint {
  return {
    periodId: 'p',
    label: '2026 Q1',
    dueDate: '2026-04-15',
    filed: 0,
    onTime: 0,
    late: 0,
    approved: 0,
    rejected: 0,
    expected: 0,
    notFiled: 0,
    ...over,
  };
}

describe('complianceRate', () => {
  it('is what was filed out of what was owed', () => {
    expect(complianceRate(point({ filed: 3, expected: 4 }))).toBe(0.75);
  });

  it('has no answer when nobody owed a return', () => {
    expect(complianceRate(point({ filed: 0, expected: 0 }))).toBeNull();
  });

  it('never exceeds everybody', () => {
    // An operator that filed and then surrendered its licence leaves more returns than
    // obligations. That is a full house, not 200% of one.
    expect(complianceRate(point({ filed: 2, expected: 1 }))).toBe(1);
  });
});

describe('onTimeRate', () => {
  it('is measured against what arrived, not what was owed', () => {
    // Two of the three that came in were punctual. The two that never arrived are a compliance
    // question, not a punctuality one, and folding them in here would double-count them.
    expect(onTimeRate(point({ filed: 3, onTime: 2, late: 1, expected: 5 }))).toBeCloseTo(2 / 3);
  });

  it('has no answer when nothing was filed', () => {
    expect(onTimeRate(point({ filed: 0, expected: 5 }))).toBeNull();
  });
});

describe('comparePeriods', () => {
  const q1 = point({ periodId: 'q1', label: 'Q1', filed: 4, onTime: 2, late: 2, expected: 8 });
  const q2 = point({ periodId: 'q2', label: 'Q2', filed: 6, onTime: 5, late: 1, expected: 8 });

  it('reads the newest period against the one before it', () => {
    const c = comparePeriods([q1, q2])!;
    expect(c.current.label).toBe('Q2');
    expect(c.previous?.label).toBe('Q1');
    expect(c.filedChange).toBeCloseTo(0.5); // four returns became six
  });

  it('counts a rate change in points, not as a percentage of itself', () => {
    /*
     * The distinction this whole file exists for. On-time filing went from 2 of 4 to 5 of 6, which
     * is 50% to about 83%. That is a rise of roughly 33 points. Reported as a relative change it
     * would read "up 67%", which says something quite different and is not true of the rate.
     */
    const c = comparePeriods([q1, q2])!;
    expect(c.onTimeRatePoints).toBeCloseTo(1 / 3);
    expect(formatPointChange(c.onTimeRatePoints)).toBe('up 33 points');
    expect(formatRelativeChange(c.onTimeRatePoints)).toBe('up 33%'); // the wrong words, not used
  });

  it('declines to compare against a period in which nothing was filed', () => {
    // Otherwise the first return ever filed reads as infinite growth.
    const empty = point({ periodId: 'q0', label: 'Q0', filed: 0, expected: 8 });
    const c = comparePeriods([empty, q2])!;
    expect(c.filedChange).toBeNull();
    expect(formatRelativeChange(c.filedChange)).toBeNull();
    // The compliance rate still compares: zero of eight against six of eight is a real movement.
    expect(c.complianceRatePoints).toBeCloseTo(0.75);
  });

  it('has nothing to compare a single period against', () => {
    const c = comparePeriods([q2])!;
    expect(c.previous).toBeNull();
    expect(c.filedChange).toBeNull();
    expect(c.complianceRate).toBeCloseTo(0.75);
  });

  it('returns nothing for an empty series', () => {
    expect(comparePeriods([])).toBeNull();
  });
});

describe('wording', () => {
  it('names the direction', () => {
    expect(formatRelativeChange(0.12)).toBe('up 12%');
    expect(formatRelativeChange(-0.04)).toBe('down 4%');
    expect(formatPointChange(0.05)).toBe('up 5 points');
    expect(formatPointChange(-0.01)).toBe('down 1 point');
  });

  it('calls a rounding-sized movement no change, rather than up 0%', () => {
    expect(formatRelativeChange(0.003)).toBe('no change');
    expect(formatPointChange(-0.002)).toBe('no change');
    expect(changeDirection(0.003)).toBe('flat');
  });

  it('shows a dash where there is no rate', () => {
    expect(formatRate(null)).toBe('—');
    expect(formatRate(0.756)).toBe('76%');
  });
});
