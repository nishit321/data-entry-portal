import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { FloatingPanel } from './_popover';

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** ISO `yyyy-mm-dd` → display `dd/mm/yyyy`. */
function toDisplay(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toISO(y: number, m: number, d: number): string {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}

/** Monday-first weekday index (0=Mon … 6=Sun) for a JS day-of-week. */
function mondayIndex(jsDay: number): number {
  return (jsDay + 6) % 7;
}

function parseISO(iso: string): Date | null {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/**
 * Themed date field with a calendar popover (FRONTEND_STANDARDS §3.9) — replaces the native
 * browser date popup. Value is an ISO `yyyy-mm-dd` string; displays as `dd/mm/yyyy`.
 *
 * The calendar is a real grid with arrow-key navigation (§6): a picker that can only be operated
 * with a mouse isn't a control, it's a picture of one. `min`/`max` express a real constraint —
 * a reporting period's due date cannot precede its start — by making the impossible dates
 * unclickable rather than by rejecting them after the fact.
 */
export function DatePicker({
  value,
  onChange,
  id,
  disabled,
  invalid,
  min,
  max,
  placeholder = 'dd/mm/yyyy',
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  /** Earliest selectable date, ISO `yyyy-mm-dd`. */
  min?: string;
  /** Latest selectable date, ISO `yyyy-mm-dd`. */
  max?: string;
  placeholder?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Which month the calendar is showing. Seeded from the value, else today.
  const seed = useMemo(() => {
    if (value) {
      const [y, m] = value.split('-').map(Number);
      if (y && m) return { year: y, month: m - 1 };
    }
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  }, [value]);

  const [view, setView] = useState(seed);
  /** The cell the keyboard is on. Separate from the selection: you browse before you choose. */
  const [focusedISO, setFocusedISO] = useState('');

  // Every time the calendar opens (and whenever the selected value changes) jump it to the
  // right month: the chosen date's month, or the current month when nothing is chosen yet.
  // Without this, reopening an untouched picker would show wherever the user last browsed to.
  useEffect(() => {
    if (!open) return;
    setView(seed);
    setFocusedISO(value || toISO(seed.year, seed.month, new Date().getDate()));
  }, [open, seed, value]);

  // Keep the DOM focus on whichever day cell the keyboard is on.
  useEffect(() => {
    if (!open || !focusedISO) return;
    gridRef.current?.querySelector<HTMLElement>(`[data-iso="${focusedISO}"]`)?.focus();
  }, [open, focusedISO]);

  // Whole weeks, because `role="grid"` is only meaningful when it is made of rows. A flat run of
  // cells renders identically and reads as nothing: a screen reader announcing "column 3" with no
  // row to place it in tells the listener less than silence would.
  const weeks = useMemo(() => {
    const first = new Date(view.year, view.month, 1);
    const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
    const lead = mondayIndex(first.getDay());
    const cells: (number | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
  }, [view]);

  const today = new Date();
  const todayISO = toISO(today.getFullYear(), today.getMonth(), today.getDate());

  const isOutOfRange = (iso: string) => (min && iso < min) || (max && iso > max);

  const move = (delta: number) => {
    const m = view.month + delta;
    setView({ year: view.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 });
  };

  const commit = (iso: string) => {
    if (isOutOfRange(iso)) return;
    onChange(iso);
    setOpen(false);
    triggerRef.current?.focus();
  };

  /** Shift the keyboard cursor by a number of days, following it across month boundaries. */
  const shiftFocus = (days: number) => {
    const base = parseISO(focusedISO) ?? new Date();
    base.setDate(base.getDate() + days);
    const iso = toISO(base.getFullYear(), base.getMonth(), base.getDate());
    setFocusedISO(iso);
    if (base.getMonth() !== view.month || base.getFullYear() !== view.year) {
      setView({ year: base.getFullYear(), month: base.getMonth() });
    }
  };

  const onGridKeyDown = (e: React.KeyboardEvent) => {
    const step: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: 7,
      ArrowUp: -7,
    };
    if (e.key in step) {
      e.preventDefault();
      shiftFocus(step[e.key]!);
    } else if (e.key === 'PageDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'PageUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setFocusedISO(toISO(view.year, view.month, 1));
    } else if (e.key === 'End') {
      e.preventDefault();
      setFocusedISO(toISO(view.year, view.month, new Date(view.year, view.month + 1, 0).getDate()));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (focusedISO) commit(focusedISO);
    }
  };

  return (
    <div>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        // Not `aria-invalid`: a button does not support it, so it announced nothing. The error
        // itself is what a reader needs, and `Field` points at it with `aria-describedby`.
        aria-describedby={ariaDescribedBy}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-2 rounded-md border bg-white px-3 py-2 text-left text-sm shadow-sm transition focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500 ${
          invalid
            ? 'border-danger-500 focus-visible:border-danger-500 focus-visible:ring-danger-500/30'
            : 'border-gray-300 focus-visible:border-brand focus-visible:ring-brand/30'
        }`}
      >
        <span className={value ? 'text-gray-900' : 'text-gray-500'}>
          {value ? toDisplay(value) : placeholder}
        </span>
        <Calendar size={16} className="shrink-0 text-gray-500" aria-hidden />
      </button>

      <FloatingPanel
        anchorRef={triggerRef}
        open={open}
        onClose={() => setOpen(false)}
        className="w-64 rounded-md border border-gray-200 bg-white p-3 shadow-lg"
      >
        <div
          role="dialog"
          aria-label={ariaLabel ? `Choose a date for ${ariaLabel}` : 'Choose date'}
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => move(-1)}
              aria-label="Previous month"
              className="rounded p-1 text-gray-500 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <ChevronLeft size={16} />
            </button>
            <span aria-live="polite" className="text-sm font-medium text-gray-800">
              {MONTHS[view.month]} {view.year}
            </span>
            <button
              type="button"
              onClick={() => move(1)}
              aria-label="Next month"
              className="rounded p-1 text-gray-500 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div
            ref={gridRef}
            role="grid"
            // Focusable but not tabbable: the roving tab stop sits on a day cell.
            tabIndex={-1}
            aria-label={`${MONTHS[view.month]} ${view.year}`}
            onKeyDown={onGridKeyDown}
            className="space-y-0.5"
          >
            <div
              role="row"
              className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[11px] font-medium text-gray-500"
            >
              {WEEKDAYS.map((w, i) => (
                // The two-letter form is for the eye; the full name is what gets announced. Real
                // text either way — a header whose only content is hidden reads as an empty one.
                <div key={w} role="columnheader">
                  <span className="sr-only">{WEEKDAY_NAMES[i]}</span>
                  <span aria-hidden>{w}</span>
                </div>
              ))}
            </div>

            {weeks.map((week, w) => (
              <div
                key={week.find((d) => d !== null) ?? `w${w}`}
                role="row"
                className="grid grid-cols-7 gap-0.5"
              >
                {week.map((d, i) => {
                  if (d === null) return <div key={`pad-${w}-${i}`} role="gridcell" />;
                  const iso = toISO(view.year, view.month, d);
                  const isSelected = iso === value;
                  const isToday = iso === todayISO;
                  const outOfRange = isOutOfRange(iso);
                  return (
                    <button
                      key={iso}
                      type="button"
                      role="gridcell"
                      data-iso={iso}
                      disabled={!!outOfRange}
                      // Roving tabindex: one cell in the grid is tabbable, the arrows move which.
                      tabIndex={iso === focusedISO ? 0 : -1}
                      onClick={() => commit(iso)}
                      onFocus={() => setFocusedISO(iso)}
                      aria-current={isToday ? 'date' : undefined}
                      aria-selected={isSelected}
                      aria-label={`${d} ${MONTHS[view.month]} ${view.year}`}
                      className={`flex h-8 items-center justify-center rounded-md text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:text-gray-300 ${
                        isSelected
                          ? 'bg-brand text-white'
                          : outOfRange
                            ? ''
                            : isToday
                              ? 'text-brand ring-1 ring-brand-200 hover:bg-brand-50'
                              : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {value && (
            <button
              type="button"
              onClick={() => {
                onChange('');
                setOpen(false);
                triggerRef.current?.focus();
              }}
              className="mt-2 w-full rounded-md py-1 text-xs text-gray-500 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              Clear
            </button>
          )}
        </div>
      </FloatingPanel>
    </div>
  );
}
