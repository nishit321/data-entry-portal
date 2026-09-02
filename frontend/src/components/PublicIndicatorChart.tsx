import type { PublicPoint } from '../lib/types';

const CHART_HEIGHT = 140;

function formatValue(value: number): string {
  if (Math.abs(value) >= 1_000_000)
    return `${(value / 1_000_000).toLocaleString('en-GB', { maximumFractionDigits: 1 })}m`;
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 1000).toLocaleString('en-GB')}k`;
  return value.toLocaleString('en-GB', { maximumFractionDigits: 2 });
}

/**
 * A published figure over recent periods, drawn without a charting library so the public page
 * carries nothing it does not need.
 *
 * Periods where the figure was withheld are drawn as an empty slot rather than skipped. A gap in
 * the run is the honest picture: something was not published for that quarter, and quietly closing
 * the gap would suggest a continuous series that does not exist.
 */
export function PublicIndicatorChart({
  points,
  unit,
}: {
  points: PublicPoint[];
  unit: string | null;
}) {
  const values = points.filter((p) => p.value !== null).map((p) => p.value as number);
  const max = Math.max(1, ...values);

  const description = points
    .map((p) => (p.withheld ? `${p.label}: not published` : `${p.label}: ${formatValue(p.value!)}`))
    .join('. ');

  return (
    <div className="overflow-x-auto">
      <div
        className="flex min-w-full items-end gap-3"
        style={{ height: CHART_HEIGHT }}
        role="img"
        aria-label={`${unit ?? 'Figure'} by period. ${description}`}
      >
        {points.map((point) => {
          const height = point.value === null ? 0 : Math.max(4, (point.value / max) * CHART_HEIGHT);
          return (
            <div
              key={point.periodId}
              className="flex min-w-14 flex-1 flex-col items-center gap-1.5"
            >
              <div className="text-xs font-medium tabular-nums text-gray-700">
                {point.value === null ? '—' : formatValue(point.value)}
              </div>
              <div className="flex w-full flex-1 items-end justify-center">
                {point.value === null ? (
                  <div
                    className="w-full rounded-t border border-dashed border-gray-200"
                    style={{ height: 12 }}
                    aria-hidden
                  />
                ) : (
                  <div className="w-full rounded-t bg-brand-500" style={{ height }} aria-hidden />
                )}
              </div>
              <div className="max-w-full truncate text-xs text-gray-500">{point.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
