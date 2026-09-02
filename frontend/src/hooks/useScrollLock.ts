import { useEffect } from 'react';

// One place that freezes the page behind an overlay (FRONTEND_STANDARDS §3.10).
//
// Two overlays can be open at once — a ConfirmDialog raised from inside a Modal — and if each
// one saved and restored `overflow` by itself, closing the inner one would hand the scroll back
// while the outer one is still up. So locks are counted: the first one applies the style, the
// last one to leave restores it.

let lockCount = 0;
let restore: (() => void) | null = null;

function applyLock() {
  const { body, documentElement } = document;
  const previousOverflow = body.style.overflow;
  const previousPadding = body.style.paddingRight;

  // Removing the scrollbar shifts the layout under the overlay. Pad by exactly the width the
  // scrollbar occupied so nothing jumps. On overlay-scrollbar platforms this is 0 and the
  // padding is a no-op.
  const scrollbarWidth = window.innerWidth - documentElement.clientWidth;
  body.style.overflow = 'hidden';
  if (scrollbarWidth > 0) {
    const current = parseFloat(window.getComputedStyle(body).paddingRight) || 0;
    body.style.paddingRight = `${current + scrollbarWidth}px`;
  }

  return () => {
    body.style.overflow = previousOverflow;
    body.style.paddingRight = previousPadding;
  };
}

/** Freeze page scroll while `active` is true. Safe to nest — locks are reference-counted. */
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    lockCount += 1;
    if (lockCount === 1) restore = applyLock();

    return () => {
      lockCount -= 1;
      if (lockCount === 0) {
        restore?.();
        restore = null;
      }
    };
  }, [active]);
}
