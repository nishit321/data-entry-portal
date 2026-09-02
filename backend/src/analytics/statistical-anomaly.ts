/**
 * The statistical layer over the trend flags (Phase 3, `ml-anomaly`).
 *
 * A word about what this is and is not, because "ML-assisted anomaly detection" invites the wrong
 * thing to be built.
 *
 * The Phase 2 detector answers one question: did this figure move a lot against its own recent
 * median? That catches the obvious. It also misses two things and cries wolf about a third:
 *
 * - **It has no idea how noisy a series normally is.** A figure that swings 40% every quarter and a
 *   figure that never moves are judged against the same fixed threshold, so one is under-flagged
 *   and the other over-flagged.
 * - **It cannot see a quarterly pattern.** An operator whose traffic always peaks in Q4 gets flagged
 *   every December for behaving exactly as it always has.
 * - **It cannot see a slow drift.** Ten quarters of 8% growth is a doubling nobody was told about,
 *   and not one of those quarters trips a 50% threshold.
 *
 * What is used, and why it is not a neural network:
 *
 * - **A robust z-score** (median absolute deviation) learns each series' own noise from its own
 *   history, so the threshold adapts per question and per operator. That *is* an unsupervised model
 *   fitted to data; it is simply one whose parameters are two numbers a person can read.
 * - **Seasonal comparison** against the same quarter in previous years, when there is enough
 *   history to have a view.
 * - **Drift detection** over the whole window, for the movement no single step reveals.
 *
 * A regulator has to be able to explain a flag to the operator it was raised against, and defend it
 * if challenged. "Our model scored it 0.91" is not a defence. Every score here reduces to a sentence
 * with the arithmetic in it, and there is no training set to go stale, no labels nobody has, and
 * nothing to retrain when NCA publishes a new questionnaire. With two or three MNOs and a handful
 * of years of quarters there is not the data to fit anything heavier, and pretending otherwise
 * would be fitting noise and calling it insight.
 */

export type StatisticalKind = 'OUTLIER' | 'SEASONAL_BREAK' | 'DRIFT';

export interface StatisticalPoint {
  periodId: string;
  periodLabel: string;
  dueDate: Date;
  value: number;
  approved: boolean;
}

export interface StatisticalFinding {
  kind: StatisticalKind;
  /**
   * How unusual, on a scale where 1 is "at the threshold". Comparable across questions and
   * operators, which a raw percentage is not.
   */
  score: number;
  severity: 'HIGH' | 'MEDIUM';
  value: number;
  /** What the figure was judged against. */
  expected: number;
  /** How much this series normally moves, in its own units. */
  typicalSwing: number;
  /** How many prior figures the judgement rests on. */
  historySize: number;
  explanation: string;
}

export interface StatisticalOptions {
  /** Robust z-score past which a figure is worth a look. */
  outlierZ: number;
  /** And past which it leads the list. */
  severeZ: number;
  /** Fewer approved figures than this and the noise estimate means nothing. */
  minHistory: number;
  /** Total drift across the window, as a proportion, past which it is worth saying. */
  driftThreshold: number;
  /** How many periods make up a seasonal cycle. Four for quarterly reporting. */
  seasonLength: number;
  /**
   * A floor under the noise estimate, as a proportion of the series level. Stops a run of
   * identical figures being read as perfect precision.
   */
  noiseFloorRatio: number;
}

export const DEFAULT_STATISTICAL: StatisticalOptions = {
  outlierZ: 3.5,
  severeZ: 6,
  // Six is the fewest figures from which a median absolute deviation says anything at all. Below
  // that the "typical swing" is an artefact of which three quarters happened to be filed.
  minHistory: 6,
  driftThreshold: 0.5,
  seasonLength: 4,
  noiseFloorRatio: 0.01,
};

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Median absolute deviation: the median of how far each figure sits from the median.
 *
 * A standard deviation is the obvious choice and the wrong one here. It is computed from squared
 * distances, so the single freak quarter we are trying to find inflates the very number we would
 * be measuring it against — one big outlier hides itself, and hides the next one too. The MAD does
 * not move when one figure does.
 */
export function medianAbsoluteDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const centre = median(values);
  return median(values.map((v) => Math.abs(v - centre)));
}

/**
 * How many "normal swings" away from normal a figure is.
 *
 * The 0.6745 turns a MAD into something on the same scale as a standard deviation, so the familiar
 * intuition about what a z-score of 3 means still holds.
 */
export function robustZScore(
  value: number,
  history: number[],
  noiseFloorRatio = DEFAULT_STATISTICAL.noiseFloorRatio,
): number | null {
  if (history.length === 0) return null;
  const centre = median(history);

  // A floor under the noise estimate, proportional to the level of the series.
  //
  // Without it, a series that happens to have reported the same figure three times running gets a
  // deviation of zero, and then *any* movement scores as infinitely surprising. Reported figures
  // are not accurate to one part in a thousand — an operator counting subscribers is not measuring
  // to the nearest one — so treating a perfectly flat run as perfectly precise manufactures
  // certainty that was never in the data.
  const mad = Math.max(medianAbsoluteDeviation(history), Math.abs(centre) * noiseFloorRatio);
  if (mad === 0) {
    // A flat run of zeros. There is genuinely nothing to scale against.
    return value === centre ? 0 : null;
  }
  return Math.abs(value - centre) / (mad / 0.6745);
}

function round(n: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
}

function describe(n: number): string {
  return n.toLocaleString('en-GB', { maximumFractionDigits: 2 });
}

/**
 * Examine the newest figure in a series against everything before it.
 *
 * Returns the single most telling finding rather than a list. An analyst working a queue wants one
 * line per figure; three descriptions of the same movement is three times the reading for no more
 * information.
 */
export function detectStatistical(
  series: StatisticalPoint[],
  options: StatisticalOptions = DEFAULT_STATISTICAL,
): StatisticalFinding | null {
  if (series.length === 0) return null;

  const ordered = [...series].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  const latest = ordered[ordered.length - 1];
  const history = ordered.slice(0, -1).filter((p) => p.approved);
  if (history.length < options.minHistory) return null;

  const values = history.map((p) => p.value);
  const centre = median(values);
  const mad = medianAbsoluteDeviation(values);

  const findings: StatisticalFinding[] = [];

  // --- Seasonal: the same quarter in previous years, when there is enough history ---
  const sameSeason = history.filter((_, i) => (history.length - i) % options.seasonLength === 0);

  /**
   * Whether this series has a seasonal shape worth judging against.
   *
   * When it does, the seasonal comparison replaces the plain one rather than joining it. An
   * operator whose traffic peaks every Q4 would otherwise be flagged every December for doing
   * exactly what it does every December — which is the single most common way an anomaly report
   * loses its readers.
   */
  let seasonalGoverns = false;

  if (sameSeason.length >= 2) {
    const seasonalValues = sameSeason.map((p) => p.value);
    const seasonalZ = robustZScore(latest.value, seasonalValues, options.noiseFloorRatio);
    const seasonalCentre = median(seasonalValues);

    // A pattern is only a pattern if the season differs from the series as a whole. Otherwise
    // there is nothing seasonal here and the ordinary comparison is the right one.
    const seasonalSpread = Math.abs(seasonalCentre - centre);
    const overallSwing = Math.max(mad, Math.abs(centre) * options.noiseFloorRatio);
    seasonalGoverns = seasonalSpread > overallSwing * 2;

    if (seasonalGoverns && seasonalZ !== null && seasonalZ > options.outlierZ) {
      findings.push({
        kind: 'SEASONAL_BREAK',
        score: round(seasonalZ / options.outlierZ, 2),
        severity: seasonalZ >= options.severeZ ? 'HIGH' : 'MEDIUM',
        value: latest.value,
        expected: round(seasonalCentre, 2),
        typicalSwing: round(medianAbsoluteDeviation(seasonalValues), 2),
        historySize: sameSeason.length,
        explanation:
          `${describe(latest.value)} against about ${describe(seasonalCentre)} in the same ` +
          `period of previous years. This question has a seasonal pattern, and this figure does ` +
          `not follow it.`,
      });
    }
  }

  // --- Outlier: unusual against this series' own noise ---
  // Skipped when the series is seasonal: the seasonal comparison above has already judged this
  // figure against the periods it should actually be compared with.
  const z = seasonalGoverns ? null : robustZScore(latest.value, values, options.noiseFloorRatio);
  if (z !== null && z > options.outlierZ) {
    findings.push({
      kind: 'OUTLIER',
      score: round(z / options.outlierZ, 2),
      severity: z >= options.severeZ ? 'HIGH' : 'MEDIUM',
      value: latest.value,
      expected: round(centre, 2),
      typicalSwing: round(mad, 2),
      historySize: history.length,
      explanation:
        mad === 0
          ? `${describe(latest.value)} where every one of the last ${history.length} periods was ` +
            `exactly ${describe(centre)}.`
          : `${describe(latest.value)} against a usual ${describe(centre)}. This question normally ` +
            `moves by about ${describe(mad)} between periods, so this is roughly ${round(z)} times ` +
            `its own normal variation.`,
    });
  }

  // --- Drift: the movement no single period reveals ---
  // Compared as the first third against the last third rather than first point against last, so
  // one unusual quarter at either end does not masquerade as a trend.
  if (history.length >= options.minHistory) {
    const third = Math.max(2, Math.floor(history.length / 3));
    const early = median(values.slice(0, third));
    const late = median(values.slice(-third));
    if (early > 0 && late > 0) {
      const change = (late - early) / Math.abs(early);

      // The *decision* is made on the log-ratio, not on the percentage.
      //
      // Percentage change is asymmetric: a doubling is +100% and a halving only -50%, so a single
      // percentage threshold flags rises roughly twice as readily as the equivalent falls. For a
      // regulator that is precisely backwards — an operator whose figures are quietly collapsing is
      // at least as interesting as one whose figures are climbing. A log-ratio treats ×2 and ×0.5
      // as the same size of movement, which is what "the same size of movement" ought to mean.
      //
      // The sentence a person reads is still in plain percentages, because that is how anyone
      // discusses it; only the threshold is symmetric.
      const magnitude = Math.abs(Math.log(late / early));
      const threshold = Math.log(1 + options.driftThreshold);

      if (magnitude >= threshold) {
        findings.push({
          kind: 'DRIFT',
          score: round(magnitude / threshold, 2),
          severity: magnitude >= threshold * 2.5 ? 'HIGH' : 'MEDIUM',
          value: latest.value,
          expected: round(early, 2),
          typicalSwing: round(mad, 2),
          historySize: history.length,
          explanation:
            `${change > 0 ? 'Risen' : 'Fallen'} steadily from about ${describe(early)} to ` +
            `${describe(late)} across ${history.length} periods, a change of ` +
            `${Math.abs(Math.round(change * 100))}%. No single period moved enough to be noticed.`,
        });
      }
    }
  }

  if (findings.length === 0) return null;
  // The strongest signal wins, and a severe one beats a moderate one whatever its score.
  findings.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'HIGH' ? -1 : 1;
    return b.score - a.score;
  });
  return findings[0];
}

export const STATISTICAL_KIND_LABELS: Record<StatisticalKind, string> = {
  OUTLIER: 'Unusual for this question',
  SEASONAL_BREAK: 'Breaks the seasonal pattern',
  DRIFT: 'Drifting over time',
};
