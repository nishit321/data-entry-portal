import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { FloatingPanel } from './_popover';
import { Spinner } from './Spinner';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Secondary line — an email under a name, a due date under a period. */
  detail?: string;
}

export interface ComboboxSource {
  /** Fetch a page of matches for `search`. Page numbers are 1-based, matching the backend. */
  fetch: (args: { search: string; page: number }) => Promise<{
    options: ComboboxOption[];
    hasNext: boolean;
  }>;
  /**
   * Resolve the currently selected value when it isn't in the first page of results. Without
   * this a selected record shows as a bare id after a reload, which looks broken.
   */
  resolve?: (value: string) => Promise<ComboboxOption | null>;
  /** Cache namespace — usually the feature name ('entities', 'users'). */
  queryKey: string;
}

const DEBOUNCE_MS = 250;

/**
 * Async single-select over a **growable** collection (FRONTEND_STANDARDS §2).
 *
 * This exists to close a real defect. Every filter that picked an entity, a user, a period, or a
 * template was fed by a `pageSize: 100` request and then rendered as a plain `Select`. Past a
 * hundred records the rest were silently missing — no message, no indication — and the user's
 * only reasonable conclusion was that the record didn't exist. The fix is not a bigger page size;
 * it's searching on the server and paging as you scroll.
 *
 * A closed, enumerable set (statuses, roles) stays on `Select`, where loading a list from the
 * network would be pure cost.
 */
export function Combobox({
  value,
  onChange,
  source,
  placeholder = 'Search…',
  emptyLabel = 'Any',
  id,
  disabled,
  invalid,
  className = '',
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
}: {
  value: string;
  /**
   * The chosen id. The option itself comes along too, because a caller that keeps its own list of
   * selections (a distribution list, a set of tags) needs the label as well as the id, and the only
   * other way to get it is a second lookup for something this component already has in hand.
   */
  onChange: (value: string, option: ComboboxOption | null) => void;
  source: ComboboxSource;
  placeholder?: string;
  /** Label for the "no selection" state — "All entities" on a filter, "None" on a form. */
  emptyLabel?: string;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rawQuery, setRawQuery] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [accumulated, setAccumulated] = useState<ComboboxOption[]>([]);
  const [active, setActive] = useState(0);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  // Debounce the typing, not the opening — the first page loads as soon as the panel appears.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(rawQuery);
      setPage(1);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [rawQuery]);

  const pageQuery = useQuery({
    queryKey: [source.queryKey, 'combobox', query, page],
    queryFn: () => source.fetch({ search: query, page }),
    enabled: open,
  });

  // Page 1 replaces the list; later pages append. Keyed on the query so a new search starts over.
  useEffect(() => {
    if (!pageQuery.data) return;
    setAccumulated((prev) =>
      page === 1 ? pageQuery.data.options : [...prev, ...pageQuery.data.options],
    );
  }, [pageQuery.data, page]);

  useEffect(() => {
    if (page === 1) setAccumulated([]);
  }, [query, page]);

  // The selected record may sit on page 40 of the source; resolve it so the trigger can name it.
  const selectedQuery = useQuery({
    queryKey: [source.queryKey, 'combobox-selected', value],
    queryFn: () => source.resolve!(value),
    enabled: !!value && !!source.resolve,
    staleTime: 5 * 60 * 1000,
  });

  const selected = useMemo(
    () => accumulated.find((o) => o.value === value) ?? selectedQuery.data ?? null,
    [accumulated, value, selectedQuery.data],
  );

  useEffect(() => {
    if (open) searchRef.current?.focus();
    else {
      setRawQuery('');
      setQuery('');
      setPage(1);
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const commit = (option: ComboboxOption | null) => {
    onChange(option?.value ?? '', option);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(accumulated.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const option = accumulated[active];
      if (option) commit(option);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  /** Load the next page once the user scrolls near the bottom of what's loaded. */
  const onListScroll = (e: React.UIEvent<HTMLUListElement>) => {
    const el = e.currentTarget;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (nearBottom && pageQuery.data?.hasNext && !pageQuery.isFetching) {
      setPage((p) => p + 1);
    }
  };

  const isFirstLoad = pageQuery.isFetching && page === 1;

  const clearable = !!value && !disabled;

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        disabled={disabled}
        role="combobox"
        aria-controls={listId}
        aria-expanded={open}
        aria-activedescendant={open && accumulated[active] ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className={`flex w-full items-center justify-between gap-2 rounded-md border bg-white px-3 py-2 text-left text-sm shadow-sm transition focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500 ${
          invalid
            ? 'border-danger-500 focus-visible:border-danger-500 focus-visible:ring-danger-500/30'
            : 'border-gray-300 focus-visible:border-brand focus-visible:ring-brand/30'
        }`}
      >
        <span
          className={`truncate ${clearable ? 'pr-6' : ''} ${
            selected ? 'text-gray-900' : 'text-gray-500'
          }`}
        >
          {selected ? selected.label : emptyLabel}
        </span>
        <ChevronDown size={16} className="shrink-0 text-gray-500" aria-hidden />
      </button>

      {/*
        A filter has to be removable in one action; making the user reopen the list to find "Any"
        is a step too many. It sits beside the trigger rather than inside it: a button cannot
        contain another button, and the version that lived in there could not be tabbed to at all,
        so clearing a filter without a mouse meant opening the list and hunting for the blank
        option.
      */}
      {clearable && (
        <button
          type="button"
          aria-label={ariaLabel ? `Clear ${ariaLabel}` : 'Clear this filter'}
          onClick={() => commit(null)}
          className="absolute right-8 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <X size={14} aria-hidden />
        </button>
      )}

      <FloatingPanel
        anchorRef={triggerRef}
        open={open}
        onClose={() => setOpen(false)}
        matchWidth
        className="rounded-md border border-gray-200 bg-white shadow-lg"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 px-2.5 py-2">
          <Search size={14} className="shrink-0 text-gray-500" aria-hidden />
          <input
            ref={searchRef}
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            aria-label={ariaLabel ? `Search ${ariaLabel}` : 'Search'}
            className="w-full text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none"
          />
          {pageQuery.isFetching && <Spinner size="xs" />}
        </div>

        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          onScroll={onListScroll}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1"
        >
          <li
            role="option"
            aria-selected={!value}
            data-index={-1}
            onMouseDown={(e) => {
              e.preventDefault();
              commit(null);
            }}
            className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm text-gray-500 hover:bg-gray-50"
          >
            {emptyLabel}
            {!value && <Check size={15} className="shrink-0 text-brand" aria-hidden />}
          </li>

          {accumulated.map((option, i) => {
            const isSelected = option.value === value;
            return (
              <li
                key={option.value}
                id={`${listId}-${i}`}
                data-index={i}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(option);
                }}
                className={`flex cursor-pointer items-start justify-between gap-2 px-3 py-2 text-sm ${
                  i === active ? 'bg-brand-50 text-brand-800' : 'text-gray-700'
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate">{option.label}</span>
                  {option.detail && (
                    <span className="block truncate text-xs text-gray-500">{option.detail}</span>
                  )}
                </span>
                {isSelected && (
                  <Check size={15} className="mt-0.5 shrink-0 text-brand" aria-hidden />
                )}
              </li>
            );
          })}
        </ul>

        {/*
          Status, not options. Inside the list these were `<li>` elements in a `listbox`, which is
          a structure a screen reader is entitled to reject — "Searching…" is not something you can
          choose. Outside it, and announced as status, they say what is happening to the person who
          cannot see the list sitting empty.
        */}
        {isFirstLoad && (
          <div role="status" className="px-3 py-3 text-sm text-gray-500">
            Searching…
          </div>
        )}

        {!isFirstLoad && accumulated.length === 0 && (
          <div role="status" className="px-3 py-3 text-sm text-gray-500">
            {query ? `Nothing matches ${query}.` : 'Nothing to choose from yet.'}
          </div>
        )}

        {pageQuery.isFetching && page > 1 && (
          <div role="status" className="px-3 py-2 text-xs text-gray-500">
            Loading more…
          </div>
        )}
      </FloatingPanel>
    </div>
  );
}
