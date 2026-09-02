import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import {
  getConnectionState,
  subscribeToConnection,
  type ConnectionState,
} from '../../lib/connection';

/**
 * The one place the app says "we can't reach the server" (FRONTEND_STANDARDS §5). It sits under
 * the top bar in the shell, so it's visible on every screen without any page carrying its own
 * offline handling. It clears itself the moment a request succeeds again.
 */
export function ConnectionBanner() {
  const [state, setState] = useState<ConnectionState>(getConnectionState);

  useEffect(() => subscribeToConnection(setState), []);

  if (state === 'online') return null;

  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-warning-200 bg-warning-50 px-4 py-2 text-sm text-warning-700 sm:px-6"
    >
      <WifiOff size={15} className="shrink-0" aria-hidden />
      <span>
        We can&apos;t reach the server right now. Anything you&apos;ve typed is still here.
        We&apos;ll keep trying.
      </span>
    </div>
  );
}
