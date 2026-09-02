/**
 * Collapse a burst of events into one call per animation frame
 * (FRONTEND_STANDARDS §7). `scroll` and `resize` fire far faster than the screen repaints, and a
 * repositioning handler that runs raw on every one of them is the difference between a popover
 * that tracks its anchor smoothly and one that stutters on a slow machine.
 *
 * The returned function carries a `cancel` so a listener teardown doesn't leave a frame queued
 * against an unmounted component.
 */
export function rafThrottle<Args extends unknown[]>(
  fn: (...args: Args) => void,
): ((...args: Args) => void) & { cancel: () => void } {
  let frame: number | null = null;
  let latest: Args | null = null;

  const run = (...args: Args) => {
    latest = args;
    if (frame !== null) return;
    frame = window.requestAnimationFrame(() => {
      frame = null;
      if (latest) fn(...latest);
    });
  };

  run.cancel = () => {
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
    latest = null;
  };

  return run;
}
