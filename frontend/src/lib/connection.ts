// One app-wide view of "can we reach the server" (FRONTEND_STANDARDS §5).
//
// The audience is on intermittent, low-bandwidth connections, so dropped requests are routine
// rather than exceptional. Rather than each screen inventing its own offline message, the API
// client reports transport failures and recoveries here and a single banner in the shell reads
// the result.
//
// `navigator.onLine` alone is not enough: it reports whether a network interface exists, not
// whether our API is reachable. A request that never got a response is the stronger signal, so
// both feed the same state.

export type ConnectionState = 'online' | 'offline';

const CHANGE_EVENT = 'nca:connection-change';

// How many consecutive transport failures before we call it: one timeout on a slow link is
// normal, two in a row means the connection is genuinely down.
const FAILURES_BEFORE_OFFLINE = 2;

let consecutiveFailures = 0;
let state: ConnectionState = 'online';

function publish(next: ConnectionState) {
  if (next === state) return;
  state = next;
  window.dispatchEvent(new CustomEvent<ConnectionState>(CHANGE_EVENT, { detail: next }));
}

/** A request failed with no response — the request never reached the server. */
export function reportNetworkFailure(): void {
  consecutiveFailures += 1;
  if (consecutiveFailures >= FAILURES_BEFORE_OFFLINE) publish('offline');
}

/** A request came back. Any response at all means the connection is up, 500s included. */
export function reportNetworkSuccess(): void {
  consecutiveFailures = 0;
  publish('online');
}

export function getConnectionState(): ConnectionState {
  return state;
}

export function subscribeToConnection(listener: (next: ConnectionState) => void): () => void {
  const onChange = (e: Event) => listener((e as CustomEvent<ConnectionState>).detail);
  // The browser's own signals are a useful head start — going offline is instant and reliable,
  // even though coming back online doesn't prove the API is reachable.
  const onBrowserOffline = () => publish('offline');
  const onBrowserOnline = () => {
    consecutiveFailures = 0;
    publish('online');
  };

  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('offline', onBrowserOffline);
  window.addEventListener('online', onBrowserOnline);

  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('offline', onBrowserOffline);
    window.removeEventListener('online', onBrowserOnline);
  };
}
