import { Loader2, type LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes, MouseEvent } from 'react';
import { Tooltip } from './Tooltip';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';
export type ButtonSize = 'sm' | 'md';

// `whitespace-nowrap` is not cosmetic. Without it a two-word label wraps as soon as the header
// gets tight — "New version" broke onto two lines and the button grew taller than the one beside
// it, which is what made the action row look broken rather than merely narrow. A button label is
// short by definition; if it doesn't fit, the layout is wrong, not the label.
//
// `aria-disabled` gets the same dimming as `disabled`, and `pointer-events-none` on top of it:
// that is what lets the wrapping tooltip see the hover. Chrome swallows pointer events over a
// control it considers disabled, ancestors included, so a tooltip on a plain `disabled` button
// never opens and the explanation is unreachable with a mouse.
const base =
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-700 focus-visible:ring-brand',
  secondary:
    'bg-white text-gray-700 border border-gray-300 shadow-sm hover:bg-gray-50 focus-visible:ring-brand',
  danger: 'bg-danger-600 text-white hover:bg-danger-700 focus-visible:ring-danger-500',
};

// Fixed heights, so a primary and a secondary button always sit level with each other and with
// the form controls next to them (`md` matches the 38px control height in `_styles`).
const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-xs',
  md: 'h-[2.375rem] px-4 text-sm',
};

const iconSizes: Record<ButtonSize, number> = { sm: 14, md: 16 };

/**
 * The single button. Style comes from enumerated props — `variant` and `size` — never a call-site
 * className override (FRONTEND_STANDARDS §3.5). The compact table-row button is `size="sm"`.
 *
 * Pass a leading icon as `icon`, not as a child. Call sites used to write
 * `<Plus size={16} className="me-1.5" />` inline, which added a margin *on top of* the button's own
 * `gap`, so the spacing between icon and label differed depending on who wrote the call. The prop
 * owns the size and the spacing.
 *
 * `isLoading` swaps the icon for a spinner and **keeps the label**. Replacing the whole label with
 * "Please wait…" changed the button's width mid-click, which moves the row under the user's cursor
 * at precisely the moment they're watching it.
 *
 * `disabledReason` is required whenever the reason is not already on screen
 * (FRONTEND_STANDARDS §3.14). A greyed-out button with nothing to explain it is a dead end: the
 * user has no way to learn what would make it work. Giving the reason also changes *how* the
 * button is disabled, from `disabled` to `aria-disabled`, which keeps it in the tab order so a
 * keyboard user can reach the explanation at all.
 */
export function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  isLoading,
  className = '',
  disabled,
  disabledReason,
  type = 'button',
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon. The button owns its size and its spacing from the label. */
  icon?: LucideIcon;
  isLoading?: boolean;
  /**
   * Why the button cannot be used right now, in the user's terms and as something they can act
   * on: "Record a data-sharing agreement first", not "no agreements". Shown on hover and focus.
   */
  disabledReason?: string;
}) {
  // Explained and unusable, rather than simply off. `isLoading` is never this case: the spinner
  // already says what is happening, and the wait is measured in moments.
  const explained = Boolean(disabled) && !isLoading && Boolean(disabledReason);

  const button = (
    <button
      type={type}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={explained ? undefined : disabled || isLoading}
      aria-disabled={explained || undefined}
      // See IconButton: this is what `e2e/disabled-controls.spec.ts` reads.
      data-disabled-reason={explained ? disabledReason : undefined}
      aria-busy={isLoading || undefined}
      onClick={explained ? (e: MouseEvent<HTMLButtonElement>) => e.preventDefault() : onClick}
      {...props}
    >
      {isLoading ? (
        <Loader2 size={iconSizes[size]} className="animate-spin" aria-hidden />
      ) : (
        Icon && <Icon size={iconSizes[size]} aria-hidden />
      )}
      {children}
    </button>
  );

  if (!explained) return button;
  return (
    <Tooltip content={disabledReason} className="cursor-not-allowed">
      {button}
    </Tooltip>
  );
}
