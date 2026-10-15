import { describe, expect, it } from 'vitest';
import { describePublishedChange, latestPublishedChange } from './published-change';
import type { PublicPoint } from './types';

function point(label: string, value: number | null, withheld = false): PublicPoint {
  return {
    periodId: label,
    label,
    dueDate: '2026-04-15',
    value,
    contributors: withheld ? 1 : 5,
    withheld,
  };
}

describe('latestPublishedChange', () => {
  it('measures the newest published figure against the one before it', () => {
    const moved = latestPublishedChange([point('Q1', 100), point('Q2', 125)])!;
    expect(moved.change).toBeCloseTo(0.25);
    expect(moved.previous.label).toBe('Q1');
  });

  it('never uses a withheld period as either end of the comparison', () => {
    /*
     * The one rule this file exists for. Q2 was held back because too few operators reported it.
     * Comparing Q3 against it and publishing the percentage would put the withheld figure back
     * within arithmetic reach of anyone who cared to work it out.
     */
    const moved = latestPublishedChange([
      point('Q1', 100),
      point('Q2', 400, true),
      point('Q3', 150),
    ])!;
    expect(moved.previous.label).toBe('Q1');
    expect(moved.change).toBeCloseTo(0.5);
  });

  it('names the period it compared against, since it may not be the one just before', () => {
    // A reader who assumed the baseline was the previous quarter would misread the sentence.
    const moved = latestPublishedChange([
      point('Q1', 100),
      point('Q2', null, true),
      point('Q3', 90),
    ])!;
    expect(describePublishedChange(moved)).toBe('Down 10% on Q1');
  });

  it('has nothing to say about a single published period', () => {
    expect(latestPublishedChange([point('Q1', 100)])).toBeNull();
    expect(latestPublishedChange([point('Q1', 100, true), point('Q2', 150)])).toBeNull();
    expect(latestPublishedChange([])).toBeNull();
  });

  it('declines to divide by a period that was zero', () => {
    expect(latestPublishedChange([point('Q1', 0), point('Q2', 500)])).toBeNull();
  });
});

describe('describePublishedChange', () => {
  it('reads as a sentence, in the reader plain words', () => {
    expect(
      describePublishedChange(latestPublishedChange([point('Q1', 100), point('Q2', 112)])!),
    ).toBe('Up 12% on Q1');
    expect(
      describePublishedChange(latestPublishedChange([point('Q1', 100), point('Q2', 100)])!),
    ).toBe('Unchanged from Q1');
  });
});
