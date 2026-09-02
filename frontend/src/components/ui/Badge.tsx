import type { ReactNode } from 'react';
import type { Tone } from '../../lib/types';

const tones: Record<Tone, string> = {
  success: 'bg-success-100 text-success-700',
  warning: 'bg-warning-100 text-warning-700',
  danger: 'bg-danger-100 text-danger-700',
  info: 'bg-info-100 text-info-700',
  gray: 'bg-gray-100 text-gray-700',
};

/**
 * Status pill. Takes a semantic `tone` (never a raw colour); the status→tone map in
 * `lib/status.ts` decides which tone a given domain status uses (FRONTEND_STANDARDS §3.3).
 */
export function Badge({ children, tone = 'gray' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
