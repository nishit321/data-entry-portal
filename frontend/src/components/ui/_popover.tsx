import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { rafThrottle } from '../../lib/raf';

// Shared floating-panel plumbing for every popover primitive (Select, Combobox, DatePicker,
// Dropdown). Renders into a body portal with `position: fixed` so the panel escapes any
// `overflow:hidden` / `overflow:auto` ancestor (a table cell, a Card) that would otherwise clip
// it. It repositions on scroll/resize, flips above when there's no room below, and coordinates a
// single-open policy so opening one popover closes any other.
//
// Scroll behaviour is the part that has to be exactly right (FRONTEND_STANDARDS §3.10):
//
//  - The panel's own scrollable content sets `overscroll-contain`, so reaching the end of an
//    option list does *not* hand the wheel to the page. Scrolling past the last option used to
//    scroll the whole audit log out from under the user.
//  - Repositioning is throttled to an animation frame rather than run per scroll event (§7).
//  - When the anchor scrolls out of view the panel closes, instead of floating over unrelated
//    content halfway down the screen.

let openSeq = 0;
const POPOVER_EVENT = 'ui:popover-open';

/** Below this much of the anchor still on screen, the panel is pointing at nothing. Close it. */
const ANCHOR_VISIBILITY_THRESHOLD = 4;

export function FloatingPanel({
  anchorRef,
  open,
  onClose,
  children,
  matchWidth,
  align = 'start',
  gap = 4,
  className = '',
}: {
  anchorRef: RefObject<HTMLElement>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Panel width tracks the anchor (for Select / Combobox). */
  matchWidth?: boolean;
  /** Horizontal edge to align to the anchor when not matching width. */
  align?: 'start' | 'end';
  gap?: number;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', top: -9999, left: -9999 });

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const a = anchor.getBoundingClientRect();
    const vh = window.innerHeight;

    // The anchor has scrolled out of its scroll container (or off screen). A panel with nothing
    // to point at is disorienting, so dismiss rather than follow it off the edge.
    const visible = Math.min(a.bottom, vh) - Math.max(a.top, 0);
    if (visible < ANCHOR_VISIBILITY_THRESHOLD) {
      onCloseRef.current();
      return;
    }

    const panel = panelRef.current;
    const panelH = panel?.offsetHeight ?? 0;
    const panelW = panel?.offsetWidth ?? a.width;
    const vw = window.innerWidth;
    const spaceBelow = vh - a.bottom;
    const openUp = spaceBelow < panelH + gap && a.top > spaceBelow;
    const top = openUp ? Math.max(8, a.top - panelH - gap) : a.bottom + gap;
    let left = align === 'end' ? a.right - panelW : a.left;
    left = Math.min(Math.max(8, left), Math.max(8, vw - panelW - 8));

    const next: CSSProperties = { position: 'fixed', top, left, zIndex: 80 };
    if (matchWidth) {
      // At least as wide as the trigger, but allowed to grow so long option labels aren't
      // clipped — capped to the viewport so it can never run off-screen.
      next.minWidth = a.width;
      next.maxWidth = Math.max(a.width, vw - 16);
    }
    // Never taller than the room it has. Without this a long list renders past the bottom of
    // the window and its last options are unreachable.
    next.maxHeight = Math.max(120, (openUp ? a.top : vh - a.bottom) - gap - 8);
    setStyle(next);
  }, [anchorRef, align, gap, matchWidth]);

  useLayoutEffect(() => {
    if (!open) return;
    if (!anchorRef.current) return;

    place();

    const onScrollOrResize = rafThrottle(place);
    // Capture phase so scrolling of any ancestor container — a table viewport, a modal body —
    // repositions the panel, not just the window.
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);

    return () => {
      onScrollOrResize.cancel();
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, place, anchorRef]);

  // Re-place once the panel's own content settles (an async option list arriving changes its
  // height, which changes whether it should have opened upwards).
  useEffect(() => {
    if (!open || !panelRef.current) return;
    const observer = new ResizeObserver(rafThrottle(place));
    observer.observe(panelRef.current);
    return () => observer.disconnect();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    if (!anchor) return;

    // Single-open policy: announce this open and close if another announces after us.
    const myTurn = ++openSeq;
    const onOtherOpen = (e: Event) => {
      if ((e as CustomEvent<number>).detail !== myTurn) onCloseRef.current();
    };
    window.addEventListener(POPOVER_EVENT, onOtherOpen);
    window.dispatchEvent(new CustomEvent<number>(POPOVER_EVENT, { detail: myTurn }));

    const onPointerDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchor.contains(t) || panelRef.current?.contains(t)) return;
      onCloseRef.current();
    };
    // ESC in capture phase so a popover inside a Modal closes the popover, not the Modal.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey, true);

    return () => {
      window.removeEventListener(POPOVER_EVENT, onOtherOpen);
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, anchorRef]);

  if (!open) return null;
  return createPortal(
    <div
      ref={panelRef}
      style={style}
      // `overscroll-contain` is the fix for scroll chaining: a wheel gesture that reaches the end
      // of this panel stops there instead of scrolling the page behind it (§3.10). It applies
      // here as well as on the inner list so a panel that scrolls as a whole is covered too.
      className={`flex flex-col overscroll-contain ${className}`}
    >
      {children}
    </div>,
    document.body,
  );
}
