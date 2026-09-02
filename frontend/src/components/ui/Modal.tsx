import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useScrollLock } from '../../hooks/useScrollLock';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * Focus-trapped modal overlay. Moves focus into the dialog on open, keeps Tab within it,
 * and restores focus to the trigger on close. Closes on ESC or via the ✕ / Cancel — never on a
 * backdrop click, so a stray click outside can't discard a half-filled form
 * (FRONTEND_STANDARDS §3.9/§6).
 */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  size = 'lg',
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Pinned action row. A long form's buttons belong here so they never scroll away (§3.12). */
  footer?: ReactNode;
  size?: 'sm' | 'lg' | 'xl';
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useScrollLock(open);
  const restoreTo = useRef<HTMLElement | null>(null);
  // Keep the latest onClose without making it an effect dependency — otherwise a parent
  // that passes an inline `onClose` re-runs this effect on every keystroke and yanks focus
  // back to the first focusable (the ✕), so the field can never be typed into.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement;

    // Move focus into the panel.
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = focusables[0];
      const lastEl = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      restoreTo.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const maxWidth = size === 'sm' ? 'max-w-md' : size === 'xl' ? 'max-w-4xl' : 'max-w-2xl';

  // Portal to <body> so the backdrop covers the whole viewport — topbar and sidebar
  // included — regardless of any transformed/positioned ancestor's stacking context.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 sm:items-center">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        // The panel is bounded by the viewport and scrolls its own body, so the title and the
        // action row stay put on a long form. Previously the backdrop scrolled instead, which
        // took the buttons with it (§3.12).
        className={`flex max-h-[calc(100vh-2rem)] w-full flex-col rounded-xl bg-white shadow-xl focus:outline-none ${maxWidth}`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
          {children}
        </div>

        {footer && <div className="shrink-0 border-t border-gray-100 px-6 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
