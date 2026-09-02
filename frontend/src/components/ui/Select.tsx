import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { FloatingPanel } from './_popover';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** How long a typeahead burst stays one word before it starts over. */
const TYPEAHEAD_RESET_MS = 600;

/**
 * Themed single-select over a **closed set** — statuses, roles, entity types, page sizes
 * (FRONTEND_STANDARDS §3.9). Replaces the native `<select>`.
 *
 * For a growable collection (entities, users, periods) use `Combobox` instead: a `Select` fed
 * from a paginated endpoint silently truncates, and the user is left thinking a record doesn't
 * exist (§2).
 *
 * Accessibility follows the combobox pattern (§6): the trigger is a `combobox` that owns a
 * `listbox`, and the active option is tracked with `aria-activedescendant` so a screen reader
 * announces each option as the arrows move — a visual highlight alone announces nothing.
 */
export function Select({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  id,
  disabled,
  invalid,
  searchable,
  className = '',
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  searchable?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeahead = useRef({ buffer: '', at: 0 });
  const listId = useId();

  const canSearch = searchable ?? options.length > 8;
  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    if (!canSearch || !query) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query, canSearch]);

  useEffect(() => {
    if (open && canSearch) searchRef.current?.focus();
    if (!open) setQuery('');
  }, [open, canSearch]);

  // Keep the active option in view as the arrows move past the edge of the visible list.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const openList = () => {
    setOpen(true);
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === value),
      ),
    );
  };

  const commit = (opt: SelectOption) => {
    if (opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  /** Jump to the option starting with what the user just typed (native `<select>` behaviour). */
  const runTypeahead = (char: string) => {
    const now = Date.now();
    const state = typeahead.current;
    state.buffer = now - state.at > TYPEAHEAD_RESET_MS ? char : state.buffer + char;
    state.at = now;

    const match = filtered.findIndex((o) => o.label.toLowerCase().startsWith(state.buffer));
    if (match >= 0) setActive(match);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openList();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive((i) => Math.min(filtered.length - 1, i + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        e.preventDefault();
        setActive(0);
        break;
      case 'End':
        e.preventDefault();
        setActive(Math.max(0, filtered.length - 1));
        break;
      case 'PageDown':
        e.preventDefault();
        setActive((i) => Math.min(filtered.length - 1, i + 10));
        break;
      case 'PageUp':
        e.preventDefault();
        setActive((i) => Math.max(0, i - 10));
        break;
      case 'Enter':
      case ' ': {
        // Space belongs to the search box when there is one — otherwise the user can't type a
        // multi-word query.
        if (e.key === ' ' && canSearch) return;
        e.preventDefault();
        const opt = filtered[active];
        if (opt) commit(opt);
        break;
      }
      case 'Tab':
        setOpen(false);
        break;
      default:
        // Single printable character with no modifier: typeahead, but only when there's no
        // search field to receive it.
        if (!canSearch && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          runTypeahead(e.key.toLowerCase());
        }
    }
  };

  const activeId = filtered[active] ? `${listId}-${active}` : undefined;

  return (
    <div className={className}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        disabled={disabled}
        role="combobox"
        aria-controls={listId}
        aria-expanded={open}
        aria-activedescendant={open ? activeId : undefined}
        aria-invalid={invalid || undefined}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        onClick={() => !disabled && (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className={`flex w-full items-center justify-between gap-2 rounded-md border bg-white px-3 py-2 text-left text-sm shadow-sm transition focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500 ${
          invalid
            ? 'border-danger-500 focus-visible:border-danger-500 focus-visible:ring-danger-500/30'
            : 'border-gray-300 focus-visible:border-brand focus-visible:ring-brand/30'
        }`}
      >
        <span className={selected ? 'truncate text-gray-900' : 'truncate text-gray-500'}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={16} className="shrink-0 text-gray-500" aria-hidden />
      </button>

      <FloatingPanel
        anchorRef={triggerRef}
        open={open}
        onClose={() => setOpen(false)}
        matchWidth
        className="rounded-md border border-gray-200 bg-white shadow-lg"
      >
        {canSearch && (
          <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 px-2.5 py-2">
            <Search size={14} className="text-gray-500" aria-hidden />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Search…"
              aria-label="Search options"
              className="w-full text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none"
            />
          </div>
        )}
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          // The scroll fix: this list keeps its scroll to itself, so reaching the last option
          // doesn't start scrolling the page underneath (§3.10).
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1"
        >
          {filtered.map((opt, i) => {
            const isSelected = opt.value === value;
            return (
              <li
                key={opt.value}
                id={`${listId}-${i}`}
                data-index={i}
                role="option"
                aria-selected={isSelected}
                aria-disabled={opt.disabled || undefined}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(opt);
                }}
                className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm ${
                  opt.disabled
                    ? 'cursor-not-allowed text-gray-300'
                    : i === active
                      ? 'bg-brand-50 text-brand-800'
                      : 'text-gray-700'
                }`}
              >
                <span className="whitespace-nowrap">{opt.label}</span>
                {isSelected && <Check size={15} className="shrink-0 text-brand" aria-hidden />}
              </li>
            );
          })}
        </ul>

        {/*
          "No matches" is not an option, so it sits outside the listbox rather than posing as a
          choice inside it, and announces itself: an empty list is obvious to the eye and silent
          to everyone else.
        */}
        {filtered.length === 0 && (
          <div role="status" className="px-3 py-2 text-sm text-gray-500">
            No matches
          </div>
        )}
      </FloatingPanel>
    </div>
  );
}
