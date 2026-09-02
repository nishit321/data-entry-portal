import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

/** "No results" / "nothing yet" placeholder with an optional primary action. */
export function EmptyState({
  message,
  action,
  icon: Icon = Inbox,
}: {
  message: string;
  action?: ReactNode;
  icon?: typeof Inbox;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-12 text-center text-gray-500">
      <Icon size={28} className="text-gray-300" aria-hidden />
      <p className="text-sm">{message}</p>
      {action}
    </div>
  );
}
