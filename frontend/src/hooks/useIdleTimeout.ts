import { useCallback, useEffect, useRef, useState } from 'react';

/** Things a person does that mean they are still there. */
const ACTIVITY = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/** How long before the deadline to warn, so nobody is cut off mid-sentence with no notice. */
const WARN_BEFORE_MS = 60_000;

/** Renew the token once this much of the idle window has passed since the last renewal. */
const RENEW_AFTER_FRACTION = 0.5;

export interface IdleTimeout {
  /** True while the countdown is on screen. */
  isWarning: boolean;
  /** Whole seconds left, for the dialog. */
  secondsLeft: number;
  /** "I am still here": clears the warning and renews the session. */
  staySignedIn: () => void;
}

/**
 * Sign somebody out after a stretch of doing nothing, and leave them alone while they work.
 *
 * The Authority asked for a session timeout of ten to twenty minutes. The portal had none: a
 * token lived a day, so a browser left open on a shared desk stayed signed in until tomorrow.
 *
 * The important word is *idle*. A timeout counted from signing in would throw somebody out in the
 * middle of a return they had spent half an hour on, and the real questionnaire is a hundred and
 * eighty-three fields; they would have to sign in again, with a one-time code, and find their
 * place. So this counts from the last thing the person actually did, and quietly renews the token
 * while they are doing things.
 *
 * Two deliberate choices worth knowing:
 *
 * Typing is not activity for the renewal, only for the clock. Renewing on every keystroke would
 * put a request on the wire for every character; the renewal happens at most once per half-window
 * and only when something is happening.
 *
 * The warning is a minute, not a second. Being signed out with no notice looks like a crash, and
 * the person has no way to tell whether what they typed survived.
 */
export function useIdleTimeout({
  idleMs,
  enabled,
  onTimeout,
  onRenew,
}: {
  idleMs: number;
  enabled: boolean;
  onTimeout: () => void;
  onRenew: () => Promise<unknown>;
}): IdleTimeout {
  const [isWarning, setIsWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const lastActivity = useRef(Date.now());
  const lastRenewal = useRef(Date.now());
  const renewing = useRef(false);

  // Held in refs so the ticking effect below does not have to be torn down and rebuilt every time
  // a parent re-renders with a new closure.
  const onTimeoutRef = useRef(onTimeout);
  const onRenewRef = useRef(onRenew);
  onTimeoutRef.current = onTimeout;
  onRenewRef.current = onRenew;

  const markActive = useCallback(() => {
    lastActivity.current = Date.now();
  }, []);

  const staySignedIn = useCallback(() => {
    markActive();
    setIsWarning(false);
    lastRenewal.current = Date.now();
    void onRenewRef.current();
  }, [markActive]);

  useEffect(() => {
    if (!enabled) return;
    for (const event of ACTIVITY) {
      window.addEventListener(event, markActive, { passive: true });
    }
    return () => {
      for (const event of ACTIVITY) window.removeEventListener(event, markActive);
    };
  }, [enabled, markActive]);

  useEffect(() => {
    if (!enabled) {
      setIsWarning(false);
      return;
    }
    lastActivity.current = Date.now();
    lastRenewal.current = Date.now();

    /*
     * One second, not one timer per deadline.
     *
     * A `setTimeout` for the warning and another for the sign-out would both be wrong after the
     * machine has been asleep: timers do not fire while a laptop is shut, so somebody could open
     * it an hour later and still be signed in. Comparing against the clock is right either way,
     * because the clock moved even if nothing else did.
     */
    const tick = window.setInterval(() => {
      const idleFor = Date.now() - lastActivity.current;
      const remaining = idleMs - idleFor;

      if (remaining <= 0) {
        setIsWarning(false);
        onTimeoutRef.current();
        return;
      }

      setIsWarning(remaining <= WARN_BEFORE_MS);
      setSecondsLeft(Math.ceil(remaining / 1000));

      // Still working, and the token is getting on: get a fresh one before anything notices.
      const sinceRenewal = Date.now() - lastRenewal.current;
      const activeRecently = idleFor < idleMs * RENEW_AFTER_FRACTION;
      if (activeRecently && sinceRenewal > idleMs * RENEW_AFTER_FRACTION && !renewing.current) {
        renewing.current = true;
        lastRenewal.current = Date.now();
        void onRenewRef.current().finally(() => {
          renewing.current = false;
        });
      }
    }, 1000);

    return () => window.clearInterval(tick);
  }, [enabled, idleMs]);

  return { isWarning, secondsLeft, staySignedIn };
}
