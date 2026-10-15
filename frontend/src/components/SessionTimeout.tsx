import { useCallback } from 'react';
import { Button, Modal } from './ui';
import { useAuth } from '../context/AuthContext';
import { usePublicSettings } from '../hooks/usePublicSettings';
import { useIdleTimeout } from '../hooks/useIdleTimeout';
import { authApi } from '../lib/auth.api';

/** Twenty minutes, used only until the server has said what it actually is. */
const FALLBACK_IDLE_MINUTES = 20;

/**
 * Signing somebody out after a stretch of doing nothing (NCA, 15 October 2026).
 *
 * Mounted once, inside the signed-in shell. The clock itself is in `useIdleTimeout`; what lives
 * here is the one thing a person sees of it - a minute's warning, and a way to say they are still
 * there.
 *
 * Unsaved work is not at risk from this. A return saves itself as it is typed, and signing out
 * carries the page you were on into the sign-in screen, which brings you back to it afterwards.
 * The warning says so, because the first thing anybody wants to know when a box like this appears
 * is whether they are about to lose an hour.
 */
export function SessionTimeout() {
  const { user, logout } = useAuth();
  const { idleMinutes } = usePublicSettings();

  const onTimeout = useCallback(() => {
    // Through the same door as an expired token, so the sign-in screen explains itself the same
    // way and returns the person to the page they were on.
    logout();
    const next = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`/login?${new URLSearchParams({ next, reason: 'expired' })}`);
  }, [logout]);

  const { isWarning, secondsLeft, staySignedIn } = useIdleTimeout({
    idleMs: (idleMinutes ?? FALLBACK_IDLE_MINUTES) * 60_000,
    enabled: !!user,
    onTimeout,
    onRenew: authApi.refresh,
  });

  if (!user) return null;

  return (
    <Modal
      open={isWarning}
      title="Still there?"
      size="sm"
      // Dismissing it is staying signed in. A box that can be closed without answering would
      // leave somebody thinking they had dealt with it.
      onClose={staySignedIn}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onTimeout}>
            Sign out now
          </Button>
          <Button onClick={staySignedIn}>Stay signed in</Button>
        </div>
      }
    >
      <p className="text-sm text-gray-700">
        You will be signed out in {secondsLeft} second{secondsLeft === 1 ? '' : 's'} because nothing
        has happened for a while.
      </p>
      <p className="mt-2 text-sm text-gray-500">
        Anything you have typed into a return is already saved, and signing in again brings you back
        to this page.
      </p>
    </Modal>
  );
}
