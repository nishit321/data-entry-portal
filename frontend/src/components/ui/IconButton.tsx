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
 */
export function IconButton({
  icon: Icon,
  label,
  onClick,
  variant = 'default',
  disabled,
  type = 'button',
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  variant?: IconButtonVariant;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <Tooltip content={label}>
      <button
        type={type}
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]}`}
      >
        <Icon size={16} aria-hidden />
      </button>
    </Tooltip>
  );
}
