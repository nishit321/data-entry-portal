import { formatDate } from '../lib/format';
import type { AnalyticsTrendPoint } from '../lib/types';

const CHART_HEIGHT = 180;

/**
 * On-time vs late filings per reporting period — a stacked bar per period, read left (oldest) to
 * right (newest). Deliberately dependency-free: bar heights are proportions of the busiest period,
 * so the shape is honest without needing a chart library. Colours come from the shared tone
 * palette, so it reads the same in light and dark as every other status surface.
 */
export function ComplianceTrendChart({ points }: { points: AnalyticsTrendPoint[] }) {
  const maxFiled = Math.max(1, ...points.map((p) => p.filed));

  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-success-500" aria-hidden /> On time
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-warning-500" aria-hidden /> Late
        </span>
      </div>

      <div className="overflow-x-auto">
        <div
          className="flex min-w-full items-end gap-3"
          style={{ height: CHART_HEIGHT }}
          role="img"
          aria-label={`Filings per period. ${points
            .map((p) => `${p.label}: ${p.filed} filed, ${p.late} late`)
            .join('. ')}`}
        >
          {points.map((p) => {
            const barHeight = (p.filed / maxFiled) * CHART_HEIGHT;
            const onTimeHeight = p.filed > 0 ? (p.onTime / p.filed) * barHeight : 0;
            const lateHeight = p.filed > 0 ? (p.late / p.filed) * barHeight : 0;
            return (
              <div key={p.periodId} className="flex min-w-14 flex-1 flex-col items-center gap-1">
                <span className="text-xs font-medium text-gray-600">{p.filed}</span>
                <div
                  className="flex w-9 flex-col justify-end overflow-hidden rounded-t"
                  style={{ height: Math.max(barHeight, p.filed > 0 ? 4 : 0) }}
                  title={`${p.label}: ${p.onTime} on time, ${p.late} late`}
                >
                  {lateHeight > 0 && (
                    <div className="w-full bg-warning-500" style={{ height: lateHeight }} />
                  )}
                  {onTimeHeight > 0 && (
                    <div className="w-full bg-success-500" style={{ height: onTimeHeight }} />
                  )}
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
