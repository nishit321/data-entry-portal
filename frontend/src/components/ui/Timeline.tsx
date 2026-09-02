import type { ReactNode } from 'react';
import type { Tone } from '../../lib/types';

export interface TimelineEvent {
  id: string;
  title: ReactNode;
  /** Who did it, or what system recorded it. */
  actor?: ReactNode;
  when: ReactNode;
  body?: ReactNode;
  tone?: Tone;
}

const dotTone: Record<Tone, string> = {
  success: 'bg-success-500',
  warning: 'bg-warning-500',
  danger: 'bg-danger-500',
  info: 'bg-info-500',
  gray: 'bg-gray-300',
};

/**
 * The one shape for "what happened, in order" (FRONTEND_STANDARDS §3.4) — the review history on
 * a return, the change history on an audit record.
 *
 * It's an ordered list because that's what it is: order carries meaning here, and a screen reader
 * should say so.
 */
export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) return null;

  return (
    <ol className="relative space-y-5 border-l border-gray-200 pl-5">
      {events.map((event) => (
        <li key={event.id} className="relative">
          <span
            aria-hidden
            className={`absolute -left-[1.6875rem] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white ${
              dotTone[event.tone ?? 'gray']
            }`}
          />
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-sm font-medium text-gray-900">{event.title}</span>
            <span className="text-xs text-gray-500">{event.when}</span>
          </div>
          {event.actor && <p className="mt-0.5 text-sm text-gray-600">{event.actor}</p>}
          {event.body && <div className="mt-1.5 text-sm text-gray-700">{event.body}</div>}
        </li>
      ))}
    </ol>
  );
}
