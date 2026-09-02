import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import type { SaveState } from '../../hooks/useAutosave';
import { formatRelativeTime } from '../../lib/format';
import { Button } from './Button';

/**
 * What autosave is doing, in words (FRONTEND_STANDARDS §3.12).
 *
 * An editor that saves in the background owes the user a plain statement of whether their work is
 * safe. Silence reads as "nothing is being saved", which is exactly the anxiety a manual save
 * button existed to relieve. A failure carries a retry, because the whole point of removing the
 * save button is that the user shouldn't be the retry mechanism.
 */
export function SaveStatus({ state, onRetry }: { state: SaveState; onRetry?: () => void }) {
  if (state.status === 'saving') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-gray-500" role="status">
        <Loader2 size={13} className="animate-spin" aria-hidden />
        Saving…
      </span>
    );
  }

  if (state.status === 'error') {
    return (
      <span className="flex items-center gap-2 text-xs text-danger-700" role="alert">
        <AlertTriangle size={13} aria-hidden />
        We couldn&apos;t save your last change.
        {onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )}
      </span>
    );
  }

  if (state.savedAt) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-gray-500" role="status">
        <Check size={13} className="text-success-600" aria-hidden />
        Saved {formatRelativeTime(state.savedAt)}
      </span>
    );
  }

  return <span className="text-xs text-gray-500">Your answers save as you type.</span>;
}
