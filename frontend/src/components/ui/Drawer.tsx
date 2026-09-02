import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useScrollLock } from '../../hooks/useScrollLock';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * Side panel for record detail and, on a phone, the filter set (FRONTEND_STANDARDS §3.11).
 *
 * A drawer is the answer to "let me look at this row without losing my place in the list". The
 * list stays behind it, the user's scroll position and filters are untouched, and closing it puts
 * them back exactly where they were — which a full-page navigation cannot do.
 *
 * Unlike `Modal`, it **does** close on a backdrop click: a drawer holds a record to read, not a
 * half-completed form, so an outside click can't destroy work (§3.9). Anything with a form in it
 * belongs in a `Modal`.
 */
export function Drawer({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  side = 'right',
  width = 'md',
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  side?: 'right' | 'left';
  width?: 'md' | 'lg';
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useScrollLock(open);

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement;
    const panel = panelRef.current;
    (panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel)?.focus();

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
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      restoreTo.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const maxWidth = width === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg';
  const edge = side === 'right' ? 'right-0' : 'left-0';

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`absolute inset-y-0 ${edge} flex w-full flex-col bg-white shadow-xl focus:outline-none ${maxWidth}`}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-gray-900">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-gray-500">{description}</p>}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
          {children}
        </div>

        {footer && <div className="shrink-0 border-t border-gray-100 px-5 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
