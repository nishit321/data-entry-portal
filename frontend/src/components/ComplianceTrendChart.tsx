import { formatDate } from '../lib/format';
import type { AnalyticsTrendPoint } from '../lib/types';

const CHART_HEIGHT = 180;

/** What a period's bar is made of, tallest-stack first so the severity ramp reads downward. */
const SEGMENTS = [
  { key: 'notFiled', label: 'Not filed', className: 'bg-danger-500' },
  { key: 'late', label: 'Late', className: 'bg-warning-500' },
  { key: 'onTime', label: 'On time', className: 'bg-success-500' },
] as const;

/**
 * Filing against obligation, one bar per reporting period, read left (oldest) to right (newest).
 *
 * Each bar is the whole obligation: everyone who owed a return that period, split into those who
 * filed on time, those who filed late, and those who never filed at all. That last band is the
 * point of the chart. A bar drawn only from the returns that arrived cannot show a period half the
 * sector ignored, because the operators who ignored it left nothing behind to count.
 *
 * Deliberately dependency-free: heights are proportions of the busiest period, so the shape is
 * honest without a chart library. Colours come from the shared tone palette, so it reads the same
 * in light and dark as every other status surface.
 */
export function ComplianceTrendChart({ points }: { points: AnalyticsTrendPoint[] }) {
  // The obligation, or the filings if they somehow exceed it (a licence surrendered after filing).
  const total = (p: AnalyticsTrendPoint) => Math.max(p.expected, p.filed);
  const maxTotal = Math.max(1, ...points.map(total));
  const anyObligation = points.some((p) => p.expected > 0);

  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-xs text-gray-500">
        {SEGMENTS.filter((s) => s.key !== 'notFiled' || anyObligation).map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className={`size-2.5 rounded-sm ${s.className}`} aria-hidden /> {s.label}
          </span>
        ))}
      </div>

      <div className="overflow-x-auto">
        <div
          className="flex min-w-full items-end gap-3"
          style={{ height: CHART_HEIGHT }}
          role="img"
          aria-label={`Filings per period. ${points
            .map((p) =>
              p.expected > 0
                ? `${p.label}: ${p.filed} of ${p.expected} filed, ${p.late} late, ${p.notFiled} not filed`
                : `${p.label}: ${p.filed} filed, ${p.late} late`,
            )
            .join('. ')}`}
        >
          {points.map((p) => {
            const stack = total(p);
            const barHeight = (stack / maxTotal) * CHART_HEIGHT;
            const height = (count: number) => (stack > 0 ? (count / stack) * barHeight : 0);
            return (
              <div key={p.periodId} className="flex min-w-14 flex-1 flex-col items-center gap-1">
                <span className="text-xs font-medium text-gray-600">
                  {p.expected > 0 ? `${p.filed}/${p.expected}` : p.filed}
                </span>
                <div
                  className="flex w-9 flex-col justify-end overflow-hidden rounded-t"
                  style={{ height: Math.max(barHeight, stack > 0 ? 4 : 0) }}
                  title={
                    p.expected > 0
                      ? `${p.label}: ${p.onTime} on time, ${p.late} late, ${p.notFiled} not filed`
                      : `${p.label}: ${p.onTime} on time, ${p.late} late`
                  }
                >
                  {SEGMENTS.map((s) => {
                    const segment = height(p[s.key]);
                    if (segment <= 0) return null;
                    return (
                      <div
                        key={s.key}
                        className={`w-full ${s.className}`}
                        style={{ height: segment }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-2 flex min-w-full gap-3">
          {points.map((p) => (
            <div key={p.periodId} className="min-w-14 flex-1 text-center">
              <div className="truncate text-xs font-medium text-gray-700" title={p.label}>
                {p.label}
              </div>
              <div className="truncate text-[10px] text-gray-500">{formatDate(p.dueDate)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
