import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

type StatTone = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'gray';

const tones: Record<StatTone, string> = {
  brand: 'bg-brand-50 text-brand-700',
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-50 text-warning-700',
  danger: 'bg-danger-50 text-danger-700',
  info: 'bg-info-50 text-info-700',
  gray: 'bg-gray-100 text-gray-600',
};

/** Compact metric tile for dashboards. `tone` is semantic (or `brand` for identity). */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'brand',
}: {
  label: string;
  value: ReactNode;
  /**
   * A quieter second reading of the same figure, under the value.
   *
   * For the thing that qualifies a number rather than competing with it: the same amount in
   * another currency, a comparison with last quarter, what a percentage is a percentage of. It is
   * a prop rather than something a screen composes for itself, because a secondary line styled at
   * the call site is how eight tiles end up with eight different sizes of grey.
   */
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: StatTone;
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      {Icon && (
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}
        >
          <Icon size={22} aria-hidden />
        </div>
      )}
      <div className="min-w-0">
        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
        <div className="mt-0.5 truncate text-lg font-semibold text-gray-900">{value}</div>
        {hint && <div className="truncate text-xs text-gray-500">{hint}</div>}
      </div>
    </div>
  );
}
