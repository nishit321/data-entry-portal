import type { Tone } from '../../lib/types';

const barTone: Record<Tone, string> = {
  success: 'bg-success-500',
  warning: 'bg-warning-500',
  danger: 'bg-danger-500',
  info: 'bg-info-500',
  gray: 'bg-gray-400',
};

/**
 * Determinate completion bar (FRONTEND_STANDARDS §3.4) — how much of a long form is answered,
 * how far an import has run.
 *
 * The value is always written out in text beside the bar, never carried by the fill alone: a bar
 * with no number can't be read by a screen reader and can't be read precisely by anyone (§6).
 */
export function Progress({
  value,
  max = 100,
  label,
  tone = 'info',
  size = 'md',
}: {
  value: number;
  max?: number;
  /** Shown above the bar, alongside the "12 of 40" reading. */
  label?: string;
  tone?: Tone;
  size?: 'sm' | 'md';
}) {
  const safeMax = Math.max(1, max);
  const clamped = Math.min(Math.max(0, value), safeMax);
  const percent = Math.round((clamped / safeMax) * 100);

  return (
    <div>
      {label && (
        <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
          <span className="font-medium text-gray-600">{label}</span>
          <span className="text-gray-500">
            {clamped} of {safeMax}
          </span>
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-label={label}
        className={`w-full overflow-hidden rounded-full bg-gray-100 ${size === 'sm' ? 'h-1' : 'h-2'}`}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${barTone[tone]}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
