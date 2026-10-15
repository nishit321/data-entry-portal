import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIdleTimeout } from './useIdleTimeout';

/**
 * The idle clock, on a fake one.
 *
 * Every rule here is about minutes, and none of them can be checked by waiting. The clock is
 * driven forward instead, which also makes the one case nobody would ever test by hand testable:
 * a laptop that was shut and opened again an hour later.
 */

const MINUTE = 60_000;
const IDLE_MS = 20 * MINUTE;

function setup(overrides: Partial<Parameters<typeof useIdleTimeout>[0]> = {}) {
  const onTimeout = vi.fn();
  const onRenew = vi.fn().mockResolvedValue(undefined);
  const view = renderHook(() =>
    useIdleTimeout({ idleMs: IDLE_MS, enabled: true, onTimeout, onRenew, ...overrides }),
  );
  return { ...view, onTimeout, onRenew };
}

/** Move the clock and let the one-second tick run. */
async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

/** Something a person did. */
async function activity() {
  await act(async () => {
    window.dispatchEvent(new Event('pointerdown'));
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('somebody who has stopped', () => {
  it('is left alone until the last minute', async () => {
    const { result, onTimeout } = setup();
    await advance(18 * MINUTE);
    expect(result.current.isWarning).toBe(false);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('gets a minute of warning rather than vanishing', async () => {
    // Being signed out with no notice looks like a crash, and leaves no way to tell whether what
    // was typed survived.
    const { result, onTimeout } = setup();
    await advance(19 * MINUTE + 10_000);
    expect(result.current.isWarning).toBe(true);
    expect(result.current.secondsLeft).toBeGreaterThan(0);
    expect(result.current.secondsLeft).toBeLessThanOrEqual(60);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('is signed out once the window has run out', async () => {
    const { onTimeout } = setup();
    await advance(IDLE_MS + 1000);
    expect(onTimeout).toHaveBeenCalled();
  });
});

describe('somebody who is still working', () => {
  it('is never warned, however long they stay', async () => {
    /*
     * The point of counting idle time rather than session time. The real questionnaire runs to a
     * hundred and eighty-three fields; a timeout counted from signing in would throw somebody out
     * in the middle of it.
     */
    const { result, onTimeout } = setup();
    for (let i = 0; i < 6; i += 1) {
      await advance(10 * MINUTE);
      await activity();
    }
    expect(onTimeout).not.toHaveBeenCalled();
    expect(result.current.isWarning).toBe(false);
  });

  it('has their token renewed quietly, and not on every keystroke', async () => {
    // Renewing per keystroke would put a request on the wire for every character typed.
    const { onRenew } = setup();
    await advance(11 * MINUTE);
    await activity();
    await advance(1000);
    expect(onRenew).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 20; i += 1) await activity();
    await advance(1000);
    expect(onRenew).toHaveBeenCalledTimes(1);
  });

  it('can say they are still there and carry on', async () => {
    const { result, onRenew, onTimeout } = setup();
    await advance(19 * MINUTE + 30_000);
    expect(result.current.isWarning).toBe(true);

    await act(async () => result.current.staySignedIn());
    expect(result.current.isWarning).toBe(false);
    expect(onRenew).toHaveBeenCalled();

    await advance(10 * MINUTE);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});

describe('a laptop that was shut and opened later', () => {
  it('is signed out, because the clock moved even though nothing fired', async () => {
    /*
     * The case a pair of setTimeouts would get wrong. Timers do not fire while a machine is
     * asleep, so a deadline scheduled for twenty minutes away simply does not happen; the person
     * opens the lid an hour later and is still signed in. Comparing against the clock is right
     * either way.
     */
    const { onTimeout } = setup();
    await act(async () => {
      vi.setSystemTime(Date.now() + 2 * 60 * MINUTE);
      vi.advanceTimersByTime(1000);
    });
    expect(onTimeout).toHaveBeenCalled();
  });
});

describe('when there is nobody signed in', () => {
  it('does nothing at all', async () => {
    // The sign-in screen itself must not be running a timer that signs somebody out of nothing.
    const { result, onTimeout, onRenew } = setup({ enabled: false });
    await advance(5 * 60 * MINUTE);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(onRenew).not.toHaveBeenCalled();
    expect(result.current.isWarning).toBe(false);
  });
});
