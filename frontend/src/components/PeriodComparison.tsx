import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import {
  changeDirection,
  comparePeriods,
  formatPointChange,
  formatRate,
  formatRelativeChange,
} from '../lib/period-comparison';
import type { AnalyticsTrendPoint } from '../lib/types';

const DIRECTION = {
  up: { icon: TrendingUp, className: 'text-success-700' },
  down: { icon: TrendingDown, className: 'text-danger-700' },
  flat: { icon: Minus, className: 'text-gray-500' },
} as const;

/**
 * How the latest reporting period compares with the one before it.
 *
 * Every figure here is paired with the words that say which kind of movement it is: filings are a
 * count and move by a percentage, the two rates move by percentage points. The direction also has
 * a word, not only an arrow and a colour, so it survives being read aloud or printed in grey.
 */
export function PeriodComparison({ points }: { points: AnalyticsTrendPoint[] }) {
  const c = comparePeriods(points);
  if (!c) return null;

  const figures = [
    {
      label: 'Returns filed',
      value: String(c.current.filed),
      change: formatRelativeChange(c.filedChange),
      direction: changeDirection(c.filedChange),
    },
    {
      label: 'Filed of those owed',
      value: formatRate(c.complianceRate),
      change: formatPointChange(c.complianceRatePoints),
      direction: changeDirection(c.complianceRatePoints),
    },
    {
      label: 'Filed on time',
      value: formatRate(c.onTimeRate),
      change: formatPointChange(c.onTimeRatePoints),
      direction: changeDirection(c.onTimeRatePoints),
    },
  ];

  return (
    <div>
      <p className="text-sm text-gray-500">
        {c.previous
          ? `${c.current.label}, against ${c.previous.label}`
          : `${c.current.label}. Nothing earlier to compare it with yet.`}
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {figures.map((f) => {
          const tone = f.direction ? DIRECTION[f.direction] : null;
          const Icon = tone?.icon;
          return (
            <div key={f.label} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
              <div className="text-xs text-gray-500">{f.label}</div>
              <div className="mt-0.5 text-2xl font-semibold text-gray-900">{f.value}</div>
              {f.change && tone && Icon ? (
                <div
                  className={`mt-1 flex items-center gap-1 text-xs font-medium ${tone.className}`}
                >
                  <Icon size={14} aria-hidden />
                  {f.change}
                </div>
              ) : (
                // Said out loud rather than left blank: an empty slot reads as a loading state.
                // gray-500, not gray-400: on this ground 400 is 2.4:1, which axe fails and which
                // the product has never allowed for text.
                <div className="mt-1 text-xs text-gray-500">No comparison</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
