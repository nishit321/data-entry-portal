/**
 * Content-shaped loading placeholder for initial loads (FRONTEND_STANDARDS §3.7).
 * `SkeletonTable` fills the DataTable body so layout doesn't shift when rows arrive.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-gray-200 ${className}`} aria-hidden />;
}

export function SkeletonText({ className = 'h-4 w-full' }: { className?: string }) {
  return <Skeleton className={className} />;
}

/** Rows/columns of shimmer shaped like a table, used by `DataTable` while loading. */
export function SkeletonTable({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="p-4" role="status" aria-live="polite" aria-busy>
      <span className="sr-only">Loading…</span>
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4">
            {Array.from({ length: columns }).map((_, c) => (
              <Skeleton
                key={c}
                className={`h-4 ${c === 0 ? 'w-1/4' : c === columns - 1 ? 'ml-auto w-16' : 'w-1/5'}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
