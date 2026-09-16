import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutosave } from './useAutosave';

/**
 * The hook that decides whether an hour of somebody's work survives.
 *
 * The questionnaire is filled in over a long sitting on a connection that drops, and autosave is
 * the only thing standing between that and a lost afternoon. Which makes its restraint as
 * important as its saving: a hook that fires on every keystroke, or retries into a dead
 * connection every two seconds, spends a bandwidth budget that is genuinely scarce here.
 *
 * Fake timers throughout, because the debounce is the behaviour under test and waiting two real
 * seconds per case would make this the slowest file in the suite.
 */
describe('useAutosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /**
   * Advance past the debounce and let the resulting promise settle.
   *
   * Several microtask turns, not one: a save that rejects takes an extra turn to reach the catch
   * and set the state. The library's polling helper is no use here — it waits on a real timer,
   * and the fake ones these tests depend on stop it running at all, so it just times out.
   */
  async function settle(ms = 2000) {
    await act(async () => {
      vi.advanceTimersByTime(ms);
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
  }

  it('waits for the typing to stop before it saves', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(({ data }) => useAutosave({ data, onSave }), {
      initialProps: { data: { answer: '' } },
    });

    rerender({ data: { answer: 'j' } });
    await settle(1000);
    rerender({ data: { answer: 'ju' } });
    await settle(1000);
    rerender({ data: { answer: 'juba' } });
    // Three edits, two seconds apart in total: still nothing sent.
    expect(onSave).not.toHaveBeenCalled();

    await settle();
    expect(onSave).toHaveBeenCalledTimes(1);
    // And it sends what the user ended up with, not what they had typed when the timer started.
    expect(onSave).toHaveBeenCalledWith({ answer: 'juba' });
  });

  it('says plainly where it has got to', async () => {
    let resolve!: () => void;
    const onSave = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const { result, rerender } = renderHook(({ data }) => useAutosave({ data, onSave }), {
      initialProps: { data: { answer: '' } },
    });

    expect(result.current.state).toEqual({ status: 'idle', savedAt: null });

    rerender({ data: { answer: 'juba' } });
    await settle();
    // The user is told a save is in flight, which is the whole point of showing state at all.
    expect(result.current.state.status).toBe('saving');

    await act(async () => {
      resolve();
      await Promise.resolve();
    });
    expect(result.current.state.status).toBe('saved');
    expect(result.current.state.savedAt).toBeInstanceOf(Date);
  });

  it('does not save the same content twice', async () => {
    // A re-render is not an edit. Re-sending identical values burns a request on a connection
    // that cannot spare one, and makes the "saved" timestamp jump for no reason.
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(({ data }) => useAutosave({ data, onSave }), {
      initialProps: { data: { answer: 'juba' } },
    });

    rerender({ data: { answer: 'wau' } });
    await settle();
    expect(onSave).toHaveBeenCalledTimes(1);

    // Same value, new object: this is what a parent re-render looks like.
    rerender({ data: { answer: 'wau' } });
    await settle();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('reports a failure and then stays quiet', async () => {
    /*
     * The restraint that matters most. Retrying every two seconds into a connection that is down
     * achieves nothing, drains a metered link, and hides the problem behind a spinner that never
     * settles. The state goes to `error`, the screen offers a retry, and the next edit tries again
     * of its own accord.
     */
    const onSave = vi.fn().mockRejectedValue(new Error('Network request failed'));
    const { result, rerender } = renderHook(({ data }) => useAutosave({ data, onSave }), {
      initialProps: { data: { answer: '' } },
    });

    rerender({ data: { answer: 'juba' } });
    await settle();
    expect(result.current.state.status).toBe('error');
    expect(result.current.state).toMatchObject({ message: 'Network request failed' });
    expect(onSave).toHaveBeenCalledTimes(1);

    // Several debounce windows pass with nobody touching the keyboard.
    await settle(10_000);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('tries again as soon as the user edits after a failure', async () => {
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ data }) => useAutosave({ data, onSave }), {
      initialProps: { data: { answer: '' } },
    });

    rerender({ data: { answer: 'juba' } });
    await settle();
    expect(result.current.state.status).toBe('error');

    rerender({ data: { answer: 'juba 2' } });
    await settle();
    expect(result.current.state.status).toBe('saved');
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it('keeps the last successful time visible while a later save is failing', async () => {
    // "Saved at 14:02" next to an error is the honest reading: work up to that point is safe and
    // what came after is not. Dropping the timestamp would say everything is lost.
    const onSave = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error('Network request failed'));
    const { result, rerender } = renderHook(({ data }) => useAutosave({ data, onSave }), {
      initialProps: { data: { answer: '' } },
    });

    rerender({ data: { answer: 'first' } });
    await settle();
    expect(result.current.state.status).toBe('saved');
    const savedAt = result.current.state.savedAt;

    rerender({ data: { answer: 'second' } });
    await settle();
    expect(result.current.state.status).toBe('error');
    expect(result.current.state.savedAt).toBe(savedAt);
  });

  it('saves nothing at all while it is switched off', async () => {
    // A return that has been submitted is read-only. Autosaving it would be a write the server
    // rightly refuses, reported to the operator as an error they cannot act on.
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(({ data }) => useAutosave({ data, onSave, enabled: false }), {
      initialProps: { data: { answer: '' } },
    });

    rerender({ data: { answer: 'juba' } });
    await settle(10_000);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('runs at most one save at a time', async () => {
    // Two saves in flight can land out of order, and the loser overwrites the winner. On a slow
    // link that is exactly when the user is typing hardest.
    let resolveFirst!: () => void;
    const onSave = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((r) => (resolveFirst = r)))
      .mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ data }) => useAutosave({ data, onSave }), {
      initialProps: { data: { answer: '' } },
    });

    rerender({ data: { answer: 'first' } });
    await settle();
    expect(onSave).toHaveBeenCalledTimes(1);

    // Another edit, another debounce, while the first request has not come back.
    rerender({ data: { answer: 'second' } });
    await settle();
    expect(onSave).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst();
      await Promise.resolve();
    });
    expect(result.current.state.status).toBe('saved');
  });

  it('treats content as already saved once told to', async () => {
    // After an explicit "Save draft", or a fresh load, there is nothing outstanding — and firing a
    // save two seconds later would contradict the "Saved" the user was just shown.
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ data }) => useAutosave({ data, onSave }), {
      initialProps: { data: { answer: '' } },
    });

    rerender({ data: { answer: 'juba' } });
    act(() => result.current.markClean());
    await settle(10_000);
    expect(onSave).not.toHaveBeenCalled();
  });
});
