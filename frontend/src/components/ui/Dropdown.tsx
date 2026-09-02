import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import { FloatingPanel } from './_popover';

export interface MenuItem {
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
  danger?: boolean;
  disabled?: boolean;
  /** Draws a divider above this item — for separating a destructive action from the rest. */
  separatorBefore?: boolean;
}

const TRIGGER_KEBAB =
  'inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand';

/**
 * Action / overflow menu (FRONTEND_STANDARDS §3.6). Use for row actions beyond two, so a
 * table doesn't sprout competing buttons, and for the account menu in the top bar. Rendered
 * through `FloatingPanel` so it escapes table/card `overflow` and only one popover is open at a
 * time.
 *
 * Keyboard behaviour is the full menu pattern (§6): arrows move a *real* focus between items
 * (not just a highlight), Home/End jump to the ends, Enter/Space activate, ESC closes and returns
 * focus to the trigger. Tracking focus rather than an index is what makes it work with a screen
 * reader — a highlighted `<div>` announces nothing.
 */
export function Dropdown({
  items,
  trigger,
  triggerClassName,
  header,
  align = 'right',
  label = 'Actions',
}: {
  items: MenuItem[];
  trigger?: ReactNode;
  /** Replaces the default kebab styling when the trigger is something else (e.g. an avatar). */
  triggerClassName?: string;
  /** Non-interactive block at the top of the menu — the signed-in identity, for example. */
  header?: ReactNode;
  align?: 'left' | 'right';
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const enabledItems = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);

  // Move focus onto the first item when the menu opens, so the next keypress acts on the menu.
  useEffect(() => {
    if (!open) return;
    const first = enabledItems()[0];
    first?.focus();
  }, [open]);

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const buttons = enabledItems();
    if (buttons.length === 0) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      buttons[(index + 1) % buttons.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      buttons[(index - 1 + buttons.length) % buttons.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      buttons[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      buttons[buttons.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      // Tabbing out of a menu closes it — leaving it open over the next control is disorienting.
      close(false);
    }
  };

  const run = (item: MenuItem) => {
    if (item.disabled) return;
    close(true);
    item.onClick();
  };

  return (
    <div className="inline-block">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={triggerClassName ?? TRIGGER_KEBAB}
      >
        {trigger ?? <MoreHorizontal size={18} />}
      </button>

      <FloatingPanel
        anchorRef={triggerRef}
        open={open}
        onClose={() => close(true)}
        align={align === 'right' ? 'end' : 'start'}
        className="min-w-[10rem] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
      >
        {header && <div className="border-b border-gray-100 px-4 py-3">{header}</div>}
        <div
          ref={menuRef}
          role="menu"
          // Focusable but not tabbable — focus lands on the first item when the menu opens.
          tabIndex={-1}
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          // Bounded height with its own contained scroll, so a long menu never hands the wheel
          // back to the page behind it (§3.10).
          className="max-h-[min(24rem,60vh)] overflow-y-auto overscroll-contain py-1"
        >
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label}>
                {item.separatorBefore && <div className="my-1 border-t border-gray-100" />}
                <button
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => run(item)}
                  className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
                    item.danger
                      ? 'text-danger-700 hover:bg-danger-50 focus:bg-danger-50'
                      : 'text-gray-700 hover:bg-gray-50 focus:bg-gray-50'
                  }`}
                >
                  {Icon && <Icon size={15} className="shrink-0" aria-hidden />}
                  {item.label}
                </button>
              </div>
            );
          })}
        </div>
      </FloatingPanel>
    </div>
  );
}
