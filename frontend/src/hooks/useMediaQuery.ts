import { useEffect, useState } from 'react';

/** Tailwind's `lg` breakpoint, expressed the other way round: true below 1024px. */
export const BELOW_LG = '(max-width: 1023px)';

/**
 * Track a CSS media query in JavaScript. Layout stays in Tailwind (§3.8) — this is for the
 * cases where a *behaviour*, not a style, differs by width: the sidebar is a focus-trapped
 * drawer below `lg` and permanent chrome above it, and only the drawer should be made `inert`
 * when closed.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
