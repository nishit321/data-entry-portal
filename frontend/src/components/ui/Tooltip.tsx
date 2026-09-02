import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { rafThrottle } from '../../lib/raf';

type Side = 'top' | 'bottom' | 'left' | 'right';

const GAP = 6;
const EDGE = 6;

/**
 * Themed tooltip (FRONTEND_STANDARDS §3.9) — replaces the native `title` attribute. Triggers on
 * hover *and* keyboard focus, and renders through a body portal with fixed positioning so it's
 * never clipped by a table/card `overflow` (e.g. a row-action icon button). Wrap the trigger as
 * the child.
 *
 * It also dismisses on ESC: a tooltip pinned open by focus can otherwise sit on top of the thing
 * the user is trying to read, with no way to get rid of it from the keyboard (§6).
 */
export function Tooltip({
  content,
  children,
  side = 'top',
  className = '',
  block,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: Side;
  /** Applied to the trigger wrapper. Needed when the child must fill its container. */
  className?: string;
  /**
   * Lay the trigger out as a block rather than inline-flex. A table cell needs this: an
   * inline-flex wrapper sizes to its content, so the text inside never reaches the width where
   * CSS truncation kicks in and nothing ever ellipsizes.
   */
  block?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', top: -9999, left: -9999 });
  const id = useId();

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = triggerRef.current;
    if (!anchor) return;

    const place = () => {
      const a = anchor.getBoundingClientRect();
      const tip = tipRef.current;
      const w = tip?.offsetWidth ?? 0;
      const h = tip?.offsetHeight ?? 0;

      let top: number;
      let left: number;
      if (side === 'top' || side === 'bottom') {
        top = side === 'top' ? a.top - h - GAP : a.bottom + GAP;
        left = a.left + a.width / 2 - w / 2;
      } else {
        top = a.top + a.height / 2 - h / 2;
        left = side === 'left' ? a.left - w - GAP : a.right + GAP;
      }

      left = Math.min(Math.max(EDGE, left), Math.max(EDGE, window.innerWidth - w - EDGE));
      top = Math.min(Math.max(EDGE, top), Math.max(EDGE, window.innerHeight - h - EDGE));
      setStyle({ position: 'fixed', top, left, zIndex: 90 });
    };

    place();
    const onScrollOrResize = rafThrottle(place);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      onScrollOrResize.cancel();
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, side]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    // This wraps the interactive child rather than replacing it. `focus` and `blur` bubble up
    // from that child, so the tooltip opens for the keyboard as readily as for the pointer, and
    // there is no role for "element that reveals a description about the thing inside it".
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <span
      ref={triggerRef}
      className={`${block ? 'block min-w-0' : 'inline-flex'} ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      aria-describedby={open && content ? id : undefined}
    >
      {children}
      {open &&
        content &&
        createPortal(
          <span
            ref={tipRef}
            role="tooltip"
            id={id}
            style={style}
            className="pointer-events-none max-w-xs rounded-md bg-gray-900 px-2 py-1 text-xs leading-snug text-white shadow-md"
          >
            {content}
          </span>,
          document.body,
        )}
    </span>
  );
}
