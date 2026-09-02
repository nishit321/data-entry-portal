import { useCallback, useEffect, useRef, useState } from 'react';
import { useBlocker, type BlockerFunction } from 'react-router-dom';

/**
 * Guard unsaved work against navigation (FRONTEND_STANDARDS §3.12).
 *
 * Two escape routes have to be covered and they are not the same mechanism:
 *
 *  - Leaving the app — closing the tab, a browser reload, an external link — is `beforeunload`,
 *    where the browser owns the wording and we can only ask for the prompt.
 *  - Leaving the screen *inside* the app — the sidebar, a breadcrumb, the back button — is the
 *    router's blocker, where we show our own `ConfirmDialog` and can say what will be lost.
 *
 * The second case is the one that actually bites: an operator eighty fields into a questionnaire
 * clicks "Submissions" in the sidebar and, without this, the work is simply gone.
 *
 * Returns the state a `ConfirmDialog` needs. The screen renders the dialog; the hook decides
 * when it's open.
 */
export function useUnsavedChanges(isDirty: boolean) {
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      isDirty && currentLocation.pathname !== nextLocation.pathname,
    [isDirty],
  );
  const blocker = useBlocker(shouldBlock);

  // Kept in a ref so the listener can read the current value without re-binding on every
  // keystroke — this fires on a form that changes constantly.
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      // Browsers ignore custom text now and show their own wording; assigning is still what
      // triggers the prompt at all.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  return {
    /** True while a navigation is held pending the user's answer. */
    isBlocked: blocker.state === 'blocked',
    /** Discard the edits and continue to where the user was going. */
    confirmLeave: () => blocker.proceed?.(),
    /** Stay on the screen. */
    cancelLeave: () => blocker.reset?.(),
  };
}

/**
 * Track whether a form differs from what was last saved, by comparing a snapshot.
 *
 * Comparing serialised state is honest in a way that a "user typed something" flag is not: typing
 * a character and deleting it again leaves the form clean, and the guard shouldn't fire. Keep the
 * snapshot small — this runs on every change.
 */
export function useDirtyTracker<T>(current: T): {
  isDirty: boolean;
  markSaved: () => void;
} {
  const serialise = (value: T) => JSON.stringify(value);
  const [baseline, setBaseline] = useState(() => serialise(current));
  const currentJson = serialise(current);

  return {
    isDirty: currentJson !== baseline,
    markSaved: () => setBaseline(currentJson),
  };
}
