import { useEffect, useState } from 'react';
import { formatDateTime, formatRelativeTime } from '../../lib/format';
import { Tooltip } from './Tooltip';

/** How often the displayed value re-computes, so "just now" doesn't sit there for an hour. */
const TICK_MS = 60_000;

/**
 * Recency, readable at a glance (FRONTEND_STANDARDS §3.4).
 *
 * The relative reading answers the question people actually have — how long has this been
 * waiting — while the exact timestamp stays one hover away and, importantly, inside a real
 * `<time datetime>` element so it is still machine-readable and still copyable. Replacing a
 * precise timestamp with a vague one would be a loss on an audit trail; showing both is not.
 */
export function RelativeTime({
  value,
  className = '',
}: {
  value?: string | Date | null;
  className?: string;
}) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  if (!value) return <span className={className}>—</span>;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return <span className={className}>—</span>;

  return (
    <Tooltip content={formatDateTime(date)}>
      <time dateTime={date.toISOString()} className={`whitespace-nowrap ${className}`}>
        {formatRelativeTime(date)}
      </time>
    </Tooltip>
  );
}
