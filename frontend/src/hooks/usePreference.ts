import { useCallback, useEffect, useState } from 'react';

// Presentation choices the user makes about how they see the product — page size, table
// density, a collapsed sidebar (FRONTEND_STANDARDS §3.13). These persist; resetting someone's
// view on every page load is a defect.
//
// Deliberately *not* for anything that describes what is being shown — page number, filters,
// sort. Those belong in the URL so a view can be shared (§2).

const NAMESPACE = 'nca.pref';
const CHANGE_EVENT = 'nca:preference-change';

function storageKey(key: string): string {
  return `${NAMESPACE}.${key}`;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(storageKey(key));
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    // Private-browsing modes and disabled storage both throw here. A preference is not worth
    // breaking a screen over — fall back to the default and carry on.
    return fallback;
  }
}

/**
 * A persisted presentation preference. Behaves like `useState`, and stays in step across every
 * component reading the same key (so two tables both honour a density change immediately).
 */
export function usePreference<T>(key: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => read(key, fallback));

  useEffect(() => {
    // Same-tab updates come through our own event; other tabs come through `storage`.
    const onChange = (e: Event) => {
      if (e instanceof CustomEvent && e.detail !== key) return;
      setValue(read(key, fallback));
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
    // `fallback` is a literal at every call site; re-subscribing on it would churn every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(storageKey(key), JSON.stringify(next));
      } catch {
        // Storage unavailable — the choice still applies for this session.
      }
      window.dispatchEvent(new CustomEvent<string>(CHANGE_EVENT, { detail: key }));
    },
    [key],
  );

  return [value, set];
}
