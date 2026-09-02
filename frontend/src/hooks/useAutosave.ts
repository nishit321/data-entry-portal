import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveState =
  | { status: 'idle'; savedAt: Date | null }
  | { status: 'saving'; savedAt: Date | null }
  | { status: 'saved'; savedAt: Date }
  | { status: 'error'; savedAt: Date | null; message: string };

/** How long the user has to stop typing before a save goes out. */
const DEBOUNCE_MS = 2000;

/**
 * Save a long-lived draft as the user works (FRONTEND_STANDARDS §3.12).
 *
 * The questionnaire is the screen someone spends an hour on, over an unreliable connection, and
 * until now the only way to keep that work was to remember to press "Save draft". This saves on a
 * debounce instead and reports its own state plainly, so the user can see that their work is
 * safe rather than having to trust it.
 *
 * Two deliberate choices:
 *
 *  - It saves only when the content has actually changed since the last successful save. Re-saving
 *    identical values would burn requests on a connection that can't spare them.
 *  - A failure does **not** retry on a timer. Retrying into a dead connection every two seconds
 *    accomplishes nothing and hides the problem; the state goes to `error`, the UI offers a retry,
 *    and the next edit tries again anyway.
 */
export function useAutosave<T>({
  data,
  onSave,
  enabled = true,
  debounceMs = DEBOUNCE_MS,
}: {
  /** The current draft content. Compared by value to decide whether a save is needed. */
  data: T;
  onSave: (data: T) => Promise<unknown>;
  enabled?: boolean;
  debounceMs?: number;
}): { state: SaveState; saveNow: () => Promise<void>; markClean: () => void } {
  const [state, setState] = useState<SaveState>({ status: 'idle', savedAt: null });
  const serialised = JSON.stringify(data);
  const lastSaved = useRef(serialised);
  const dataRef = useRef(data);
  dataRef.current = data;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const inFlight = useRef(false);

  const save = useCallback(async () => {
    const snapshot = JSON.stringify(dataRef.current);
    if (inFlight.current) return;
    inFlight.current = true;
    setState((s) => ({ status: 'saving', savedAt: s.savedAt }));
    try {
      await onSaveRef.current(dataRef.current);
      lastSaved.current = snapshot;
      setState({ status: 'saved', savedAt: new Date() });
    } catch (error) {
      setState((s) => ({
        status: 'error',
        savedAt: s.savedAt,
        message: error instanceof Error ? error.message : 'Could not save',
      }));
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (serialised === lastSaved.current) return;
    const timer = setTimeout(() => void save(), debounceMs);
    return () => clearTimeout(timer);
  }, [serialised, enabled, debounceMs, save]);

  /** Treat the current content as already saved — after an explicit save, or a fresh load. */
  const markClean = useCallback(() => {
    lastSaved.current = JSON.stringify(dataRef.current);
  }, []);

  return { state, saveNow: save, markClean };
}
