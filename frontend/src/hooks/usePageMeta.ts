import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const SUFFIX = 'NCA Portal';

// A single live region, created once, that route changes speak through. Screen readers announce
// changes to a region that is already in the document; one created at announce-time is often
// missed, which is why this is a module-level singleton rather than per-component.
let announcer: HTMLElement | null = null;

function getAnnouncer(): HTMLElement {
  if (announcer) return announcer;
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.className = 'sr-only';
  document.body.appendChild(el);
  announcer = el;
  return el;
}

/** Speak a short message through the shared live region (result counts, save state, …). */
export function announce(message: string): void {
  const el = getAnnouncer();
  // Clearing first forces a re-announcement when the same text repeats.
  el.textContent = '';
  window.setTimeout(() => {
    el.textContent = message;
  }, 50);
}

/**
 * Everything a route change owes the user (FRONTEND_STANDARDS §6): the browser tab title, focus
 * moved to the top of the new page, and an announcement for anyone not looking at the screen.
 *
 * Without this, a screen-reader user clicks a nav item and nothing at all tells them the page
 * changed — and every tab in the browser is called the same thing.
 */
export function usePageMeta(title: string): void {
  const location = useLocation();

  useEffect(() => {
    document.title = title ? `${title} | ${SUFFIX}` : SUFFIX;
    announce(`${title} page`);

    // Focus the content region so the next Tab starts inside the new page rather than continuing
    // from wherever the user clicked in the nav. `preventScroll` because the page is already at
    // the top and a focus scroll here fights the layout.
    const main = document.getElementById('main-content');
    main?.focus({ preventScroll: true });
  }, [title, location.pathname]);
}
