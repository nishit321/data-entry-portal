import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePreference } from './usePreference';

// The one owner of "what is this list showing" (FRONTEND_STANDARDS §2, §3.11).
//
// Page, size, sort, order, search and every filter live in the query string. That makes a view
// reproducible: refresh keeps it, the back button walks it, and a link reproduces it for someone
// else. On the audit trail that isn't a convenience — an investigator has to be able to hand over
// the exact view they're describing.
//
// Two details that matter in use:
//
//  - Only non-default values are written, so an untouched list has a clean address.
//  - Filter and search changes *replace* the history entry rather than push, so the back button
//    returns to the previous screen instead of replaying every keystroke.

export type SortOrder = 'asc' | 'desc';

export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

/** Backend default (BACKEND_STANDARDS §7) and the fallback when the user has no preference. */
export const DEFAULT_PAGE_SIZE: PageSize = 20;

export interface ListParamsConfig<Filters extends Record<string, string>> {
  /** Column the backend sorts by when the user hasn't chosen one. */
  defaultSort: string;
  defaultOrder?: SortOrder;
  /**
   * Filter keys with their default (empty) value. Declaring them here is what lets the hook tell
   * "no filter" from "filtered to something", and keeps unset filters out of the URL.
   */
  filters?: Filters;
  /**
   * Namespace for the remembered page size, so a user's choice on the audit log doesn't change
   * the submissions list. Presentation preference, not view state (§3.13).
   */
  preferenceKey: string;
}

export interface ListParams<Filters extends Record<string, string>> {
  page: number;
  pageSize: PageSize;
  sort: string;
  order: SortOrder;
  search: string;
  filters: Filters;

  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  setSort: (sort: string, order: SortOrder) => void;
  setSearch: (search: string) => void;
  /** Apply one or more filters. Any change returns the list to page 1. */
  setFilters: (patch: Partial<Filters>) => void;
  clearFilter: (key: keyof Filters) => void;
  clearAll: () => void;

  /** True when search or any filter is narrowing the list — drives the chips and empty copy. */
  hasActiveFilters: boolean;
  /** Every active narrowing, ready to render as removable chips (§3.11). */
  activeFilters: { key: keyof Filters | 'search'; value: string }[];
}

function parsePageSize(raw: string | null, fallback: PageSize): PageSize {
  const n = Number(raw);
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(n) ? (n as PageSize) : fallback;
}

export function useListParams<Filters extends Record<string, string>>(
  config: ListParamsConfig<Filters>,
): ListParams<Filters> {
  const { defaultSort, defaultOrder = 'desc', preferenceKey } = config;
  const emptyFilters = useMemo(
    () => config.filters ?? ({} as Filters),
    // The caller passes an object literal; depending on the reference would rebuild every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [searchParams, setSearchParams] = useSearchParams();
  const [preferredSize, setPreferredSize] = usePreference<PageSize>(
    `page-size.${preferenceKey}`,
    DEFAULT_PAGE_SIZE,
  );

  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = parsePageSize(searchParams.get('pageSize'), preferredSize);
  const sort = searchParams.get('sort') ?? defaultSort;
  const order = (searchParams.get('order') === 'asc' ? 'asc' : 'desc') as SortOrder;
  const search = searchParams.get('search') ?? '';

  const filters = useMemo(() => {
    const out = { ...emptyFilters };
    for (const key of Object.keys(emptyFilters) as (keyof Filters)[]) {
      const value = searchParams.get(String(key));
      if (value !== null) out[key] = value as Filters[keyof Filters];
    }
    return out;
  }, [searchParams, emptyFilters]);

  /**
   * Write a patch into the query string, dropping anything back at its default so the URL only
   * ever carries what the user actually chose.
   */
  const write = useCallback(
    (patch: Record<string, string | number | undefined>, options?: { push?: boolean }) => {
      const next = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === '' || value === null) next.delete(key);
        else next.set(key, String(value));
      }
      // Page 1 and the default sort are implied — carrying them adds noise to every link.
      if (next.get('page') === '1') next.delete('page');
      if (next.get('sort') === defaultSort && next.get('order') === defaultOrder) {
        next.delete('sort');
        next.delete('order');
      }
      setSearchParams(next, { replace: !options?.push });
    },
    [searchParams, setSearchParams, defaultSort, defaultOrder],
  );

  const setPage = useCallback(
    // Paging *is* a step the user should be able to walk back through, so it pushes.
    (nextPage: number) => write({ page: nextPage }, { push: true }),
    [write],
  );

  const setPageSize = useCallback(
    (nextSize: number) => {
      const size = parsePageSize(String(nextSize), DEFAULT_PAGE_SIZE);
      setPreferredSize(size);
      write({ pageSize: size === preferredSize ? undefined : size, page: 1 });
    },
    [write, setPreferredSize, preferredSize],
  );

  const setSort = useCallback(
    (nextSort: string, nextOrder: SortOrder) =>
      write({ sort: nextSort, order: nextOrder, page: 1 }),
    [write],
  );

  const setSearch = useCallback(
    (nextSearch: string) => write({ search: nextSearch, page: 1 }),
    [write],
  );

  const setFilters = useCallback(
    (patch: Partial<Filters>) => write({ ...patch, page: 1 }),
    [write],
  );

  const clearFilter = useCallback(
    (key: keyof Filters) => write({ [String(key)]: undefined, page: 1 }),
    [write],
  );

  const clearAll = useCallback(() => {
    const cleared: Record<string, undefined> = { search: undefined, page: undefined };
    for (const key of Object.keys(emptyFilters)) cleared[key] = undefined;
    write(cleared);
  }, [write, emptyFilters]);

  const activeFilters = useMemo(() => {
    const out: { key: keyof Filters | 'search'; value: string }[] = [];
    if (search) out.push({ key: 'search', value: search });
    for (const key of Object.keys(emptyFilters) as (keyof Filters)[]) {
      const value = filters[key];
      if (value && value !== emptyFilters[key]) out.push({ key, value: String(value) });
    }
    return out;
  }, [filters, search, emptyFilters]);

  return {
    page,
    pageSize,
    sort,
    order,
    search,
    filters,
    setPage,
    setPageSize,
    setSort,
    setSearch,
    setFilters,
    clearFilter,
    clearAll,
    hasActiveFilters: activeFilters.length > 0,
    activeFilters,
  };
}
