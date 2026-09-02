import { Skeleton } from './Skeleton';

/**
 * The page-level loading state (FRONTEND_STANDARDS §5): the `Suspense` fallback while a route
 * chunk downloads, and what a route guard shows while the session is being restored.
 *
 * It is shaped like a page — header, then content blocks — rather than a bare spinner, so the
 * layout doesn't jump when the real screen lands. On a slow connection this is what the user
 * looks at for a second or two, and a centred spinner tells them nothing about what's coming.
 */
export function PageLoading() {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8"
      role="status"
      aria-busy
      aria-live="polite"
    >
      <span className="sr-only">Loading…</span>
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}
