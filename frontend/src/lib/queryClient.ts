import { keepPreviousData, QueryClient } from '@tanstack/react-query';

/**
 * One shared QueryClient. Sensible defaults for a low-bandwidth audience: data stays fresh for a
 * short window so navigating back doesn't re-hit the API, and we don't refetch on every window
 * focus.
 *
 * `placeholderData: keepPreviousData` is the important one (FRONTEND_STANDARDS §2). Without it,
 * every page change, sort, and filter keystroke throws the current rows away and the table
 * collapses into a skeleton — the layout jumps, the scroll position resets, and it reads like the
 * screen crashed and came back. With it, the previous page stays on screen while the next one
 * loads and the table simply updates. It's set as a *default* rather than per query so a new list
 * screen can't quietly opt out of it by forgetting.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
      placeholderData: keepPreviousData,
    },
  },
});
