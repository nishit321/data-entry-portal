import { Loader2 } from 'lucide-react';

const sizes = { xs: 14, sm: 16, md: 18 } as const;

/**
 * Small inline/animated wait indicator — for button-level or in-flow waits only.
 * Initial data loads use `Skeleton` instead (FRONTEND_STANDARDS §3.7).
 *
 * `size="xs"` with no label is the bare spinner used inside a control (a combobox searching),
 * where the surrounding context already says what is loading.
 */
export function Spinner({ label, size = 'md' }: { label?: string; size?: keyof typeof sizes }) {
  if (!label) {
    return (
      <Loader2
        size={sizes[size]}
        className="shrink-0 animate-spin text-gray-500"
        role="status"
        aria-label="Loading"
      />
    );
  }

  return (
    <div
      className="flex items-center justify-center gap-2 p-10 text-sm text-gray-500"
      role="status"
      aria-live="polite"
    >
      <Loader2 size={sizes[size]} className="animate-spin" aria-hidden />
      <span>{label}</span>
    </div>
  );
}
