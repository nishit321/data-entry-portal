import type { LucideIcon } from 'lucide-react';
import { Tooltip } from './Tooltip';

type IconButtonVariant = 'default' | 'danger';

const variants: Record<IconButtonVariant, string> = {
  default: 'text-gray-500 hover:bg-gray-100 hover:text-gray-700',
  danger: 'text-danger-600 hover:bg-danger-50',
};

/**
 * Compact icon-only action button — the standard shape for table row actions
 * (FRONTEND_STANDARDS §3.6): pencil to edit, trash to delete, etc. `label` is both the
 * accessible name (`aria-label`) and the tooltip text, so an icon-only control is never
 * unlabelled (§6). Consistent across every table.
 *
 * A row of greyed-out icons is the worst version of an unexplained disabled control, because
 * there is not even a word to reason from. `disabledReason` puts the reason in the tooltip under
 * the label and switches to `aria-disabled` so the control stays reachable (§3.14).
 */
export function IconButton({
  icon: Icon,
  label,
  onClick,
  variant = 'default',
  disabled,
  disabledReason,
  type = 'button',
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  variant?: IconButtonVariant;
  disabled?: boolean;
  /** Why this action is unavailable on this row, phrased as something the user can act on. */
  disabledReason?: string;
  type?: 'button' | 'submit';
}) {
  const explained = Boolean(disabled) && Boolean(disabledReason);

  return (
    <Tooltip
      className={explained ? 'cursor-not-allowed' : ''}
      content={
        explained ? (
          <>
            <span className="block font-medium">{label}</span>
            <span className="block text-gray-300">{disabledReason}</span>
          </>
        ) : (
          label
        )
      }
    >
      <button
        type={type}
        onClick={explained ? undefined : onClick}
        disabled={explained ? undefined : disabled}
        aria-disabled={explained || undefined}
        // Declares in the DOM that this control's unavailability has been explained, which is the
        // only thing a test can check: the tooltip's text lives in a portal that exists on hover
        // alone, and every IconButton is wrapped in a tooltip for its label, so the wrapper says
        // nothing. Without this attribute the audit passed on a button whose reason had been
        // deleted.
        data-disabled-reason={explained ? disabledReason : undefined}
        aria-label={label}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40 ${variants[variant]}`}
      >
        <Icon size={16} aria-hidden />
      </button>
    </Tooltip>
  );
}
