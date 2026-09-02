/**
 * Spotting figures that moved implausibly (Phase 2).
 *
 * This is deliberately separate from the `PERIOD_ON_PERIOD` validation rule. That rule is
 * configured per question, runs at submit time, and speaks to the **operator**: "this looks like a
 * typo, please confirm". This module speaks to the **Authority**: sweep everything that was filed,
 * against each operator's own history, and surface what an analyst should look at. Nothing here is
 * configured per question, because the point is to catch what nobody thought to configure.
 *
 * The maths is kept plain on purpose. A regulator has to be able to explain a flag to the operator
 * it was raised against, so every signal below reduces to a sentence a person can check by hand.
 * There is no model and no training data — with a handful of operators and a few years of
 * quarters, a model would be fitting noise.
 */

/** One reported figure in a series, oldest first. */
export interface SeriesPoint {
  periodId: string;
  periodLabel: string;
  /** Ordering key: the period's due date, so a late filing still sits in the right place. */
  dueDate: Date;
  value: number;
  /** Whether this figure has been through review. Only approved figures form a baseline. */
  approved: boolean;
}

/**
 * `DRIFT` and `SEASONAL_BREAK` are raised by the statistical layer (Phase 3) rather than by the
 * threshold rule below. They live in the same union so one list of flags reads consistently,
 * whichever layer found the movement.
 */
export type AnomalyKind =
  'SPIKE' | 'DROP' | 'NEW_ZERO' | 'FIRST_REPORT' | 'DRIFT' | 'SEASONAL_BREAK';

export type AnomalySeverity = 'HIGH' | 'MEDIUM';

export interface Anomaly {
  kind: AnomalyKind;
  severity: AnomalySeverity;
  /** The figure that was flagged. */
  value: number;
  /** What it was compared against, and how that was arrived at. */
  baseline: number | null;
  changePercent: number | null;
  /** How many prior approved figures the baseline rests on. */
  baselineSize: number;
  /** Plain-language explanation, written for someone who must justify the flag. */
  explanation: string;
}

export interface DetectionOptions {
  /** Deviation from the baseline, in percent, past which a movement is worth a look. */
  thresholdPercent: number;
  /** Above this, the movement is severe enough to lead the list. */
  highThresholdPercent: number;
  /** How many prior periods form the baseline. */
  window: number;
  /** Fewer approved figures than this and there is no baseline worth comparing against. */
  minBaseline: number;
}

export const DEFAULT_DETECTION: DetectionOptions = {
  thresholdPercent: 50,
  highThresholdPercent: 200,
  window: 4,
  minBaseline: 2,
};

/**
 * The median, not the mean.
 *
 * One freak quarter should not drag the baseline with it. A mean lets a single outlier hide the
 * next one; a median of the last few periods stays where the normal figures are.
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function pct(value: number, baseline: number): number {
  return (Math.abs(value - baseline) / Math.abs(baseline)) * 100;
}

/** Round to one decimal so an explanation reads as a figure, not a float. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Examine the newest figure in a series against the approved figures before it.
 *
 * Returns null when there is nothing to say — which is the common case, and is why this returns a
 * single optional finding rather than a list: one figure produces at most one flag, so the analyst
 * sees a queue of things to look at rather than the same movement described four ways.
 */
export function detectAnomaly(
  series: SeriesPoint[],
  options: DetectionOptions = DEFAULT_DETECTION,
): Anomaly | null {
  if (series.length === 0) return null;

  const ordered = [...series].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  const latest = ordered[ordered.length - 1];

  // Baseline: this operator's own approved history, most recent `window` periods before this one.
  const history = ordered
    .slice(0, -1)
    .filter((p) => p.approved)
    .slice(-options.window);

  if (history.length < options.minBaseline) {
    // A first figure cannot be out of line with anything, but a reviewer should still know there
    // is no history behind it — that is the period where a mistake sets the baseline for years.
    if (history.length === 0 && latest.value !== 0) {
      return {
        kind: 'FIRST_REPORT',
        severity: 'MEDIUM',
        value: latest.value,
        baseline: null,
        changePercent: null,
        baselineSize: 0,
        explanation:
          'This is the first figure reported for this question, so there is nothing to compare it against. It sets the baseline for later periods.',
      };
    }
    return null;
  }

  const values = history.map((p) => p.value);
  const baseline = median(values);

  // Falling to zero is its own signal: as a percentage it is always exactly 100%, which buries it
  // among ordinary swings, but "they used to report this and now report nothing" is a different
  // question to ask than "this moved a lot".
  if (latest.value === 0 && baseline !== 0) {
    return {
      kind: 'NEW_ZERO',
      severity: 'HIGH',
      value: 0,
      baseline,
      changePercent: 100,
      baselineSize: history.length,
      explanation: `Reported as zero, having previously been around ${round1(baseline)}. Either the service stopped or the figure was missed.`,
    };
  }

  // With no baseline to divide by, a percentage is meaningless. Reporting a real figure after a
  // run of zeros is worth surfacing, but as a start, not as a percentage swing.
  if (baseline === 0) {
    if (latest.value === 0) return null;
    return {
      kind: 'SPIKE',
      severity: 'MEDIUM',
      value: latest.value,
      baseline: 0,
      changePercent: null,
      baselineSize: history.length,
      explanation: `Reported as ${round1(latest.value)}, having previously been zero.`,
    };
  }

  const changePercent = pct(latest.value, baseline);
  if (changePercent <= options.thresholdPercent) return null;

  const rose = latest.value > baseline;
  return {
    kind: rose ? 'SPIKE' : 'DROP',
    severity: changePercent >= options.highThresholdPercent ? 'HIGH' : 'MEDIUM',
    value: latest.value,
    baseline,
    changePercent: round1(changePercent),
    baselineSize: history.length,
    explanation: `${rose ? 'Rose' : 'Fell'} by about ${Math.round(changePercent)}% against a typical ${round1(baseline)} over the previous ${history.length} ${history.length === 1 ? 'period' : 'periods'}.`,
  };
}
