import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, RotateCw, XCircle } from 'lucide-react';
import type { Tone } from '../../lib/types';
import { Button } from './Button';

type AlertTone = Exclude<Tone, 'gray'>;

const styles: Record<AlertTone, { wrap: string; icon: typeof Info }> = {
  success: { wrap: 'bg-success-50 text-success-700 border-success-200', icon: CheckCircle2 },
  warning: { wrap: 'bg-warning-50 text-warning-700 border-warning-200', icon: AlertTriangle },
  danger: { wrap: 'bg-danger-50 text-danger-700 border-danger-200', icon: XCircle },
  info: { wrap: 'bg-info-50 text-info-700 border-info-200', icon: Info },
};

/**
 * Inline, persistent message tied to the screen (a form-level server error, a standing
 * notice). Transient action outcomes are Toasts instead (FRONTEND_STANDARDS §3.7).
 * `tone` is semantic; an error Alert can offer a retry.
 */
export function Alert({
  tone = 'danger',
  children,
  onRetry,
}: {
  tone?: AlertTone;
  children: ReactNode;
  onRetry?: () => void;
}) {
  if (!children) return null;
  const { wrap, icon: Icon } = styles[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={`flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm ${wrap}`}
    >
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden />
      <div className="flex-1">{children}</div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} className="shrink-0">
          <RotateCw size={13} /> Retry
        </Button>
      )}
    </div>
  );
}
