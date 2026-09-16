import type { ReactNode } from 'react';
import { Button } from './Button';

/**
 * The bar that replaces the toolbar while rows are selected (FRONTEND_STANDARDS §3.11).
 *
 * Its own component rather than twenty lines of JSX repeated per screen, and the reason is what it
 * says rather than how it looks. A bulk action is the one place in the portal where a single click
 * changes many records, so the count has to be exact, phrased for one as well as for many, and in
 * the same words everywhere. Four hand-written copies is four chances for one of them to read
 * "1 items selected", or to lose the way out.
 *
 * `Clear` is always present and always last. Somebody who has selected forty rows across three
 * pages and changed their mind needs one button, not a scroll back through the list unticking.
 */
export function BulkBar({
  count,
  noun,
  onClear,
  children,
}: {
  count: number;
  /** What is selected, singular. "account" gives "1 account selected" / "4 accounts selected". */
  noun: string;
  onClear: () => void;
  /** The actions themselves, as buttons. */
  children: ReactNode;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2"
      // Announced, because the bar appears in place of the toolbar rather than beside it: a screen
      // reader that never hears it has no idea the page's controls have changed.
      role="status"
    >
      <span className="text-sm font-medium text-brand-800">
        {count} {count === 1 ? noun : `${noun}s`} selected
      </span>
      <div className="ms-auto flex flex-wrap gap-2">
        {children}
        <Button variant="secondary" size="sm" onClick={onClear}>
          Clear
        </Button>
      </div>
    </div>
  );
}
