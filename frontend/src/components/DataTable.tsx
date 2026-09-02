import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown, RefreshCw } from 'lucide-react';
import { Alert } from './ui/Alert';
import { Tooltip } from './ui/Tooltip';
import { Button } from './ui/Button';
import { Checkbox } from './ui/Checkbox';
import { EmptyState } from './ui/EmptyState';
import { SkeletonTable } from './ui/Skeleton';

export type SortOrder = 'asc' | 'desc';
export type Density = 'comfortable' | 'compact';

/** Above this many rows the body virtualizes (FRONTEND_STANDARDS §7). */
const VIRTUALIZE_ABOVE = 60;
/** Row heights per density, in pixels. Virtualization needs a known height to do its maths. */
const ROW_HEIGHT: Record<Density, number> = { comfortable: 53, compact: 41 };
/** Rows rendered beyond the visible window, so a fast scroll doesn't show blank space. */
const OVERSCAN = 8;

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right';
  /**
   * Declared width (any CSS length). Widths are declared rather than inferred so columns don't
   * jump between pages when a cell's content changes, and so the loading skeleton matches the
   * real layout (§3.11).
   */
  width?: string;
  /** Extra classes for the cell (e.g. muting). */
  className?: string;
  /**
   * When set (together with the table's `onSortChange`), the header becomes a clickable sort
   * control. The value is the backend sort column name.
   */
  sortKey?: string;
  /** Hidden below `sm` — for columns that matter less on a phone (§3.8). */
  hideOnMobile?: boolean;
  /**
   * Opt out of the truncation tooltip (§3.11). Rarely needed: a cell already skips it when its
   * content explains itself, so this is for text that is deliberately abbreviated.
   */
  noTooltip?: boolean;
  /** Stable identifier. Falls back to the header text. */
  id?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  /** A background refresh with rows already on screen — dims rather than replacing them (§2). */
  refreshing?: boolean;
  /** True when the list query failed — shown as an error, never as an empty result. */
  error?: boolean;
  onRetry?: () => void;
  emptyMessage?: string;
  emptyAction?: ReactNode;
  sort?: string;
  order?: SortOrder;
  onSortChange?: (sortKey: string, order: SortOrder) => void;
  density?: Density;

  /** Clicking a row opens its record. Row actions still take precedence (§3.11). */
  onRowClick?: (row: T) => void;
  /** Marks the row that's currently open in a drawer, so the table shows where the user is. */
  activeRowKey?: string;

  /** Selection is opt-in per screen; when on, the primitive owns the checkbox column (§3.11). */
  selectable?: boolean;
  selectedKeys?: Set<string>;
  onSelectionChange?: (keys: Set<string>) => void;
  /** Rows that can't be selected (e.g. a record this user may not act on). */
  isRowSelectable?: (row: T) => boolean;
}

const cellPadding: Record<Density, string> = {
  comfortable: 'px-4 py-3',
  compact: 'px-3 py-2',
};

/** Anything a user can operate in its own right. */
const INTERACTIVE = 'button, a, input, select, textarea, label, [role="button"], [role="menuitem"]';

/**
 * True when the click started on a control **inside** the row rather than on the row itself.
 *
 * A row-level click handler sees every click anywhere inside the row, including the ones on its
 * own action buttons. Without this guard, pressing the deactivate icon *also* fired the row's
 * "open this record", so one press did two things and a second press stacked a dialog on the
 * first. A row action must do one thing: the thing on its tooltip.
 *
 * `row` has to be excluded explicitly, and this is the subtle part: a clickable row carries
 * `role="button"` itself (§6), so a bare `closest(INTERACTIVE)` walks up from the click target and
 * matches *the row* — which made the guard true for every click and stopped rows opening at all.
 * The control has to be a genuine descendant to count.
 */
function startedOnAControl(target: EventTarget | null, row: HTMLElement): boolean {
  if (!(target instanceof Element)) return false;
  const control = target.closest(INTERACTIVE);
  return control !== null && control !== row && row.contains(control);
}

/**
 * Elements that already explain themselves on hover, so a second tooltip would fight the first.
 * Both are semantic signals rather than guesses: a `<time>` is what `RelativeTime` renders (its
 * own tooltip carries the exact timestamp, which is *more* than the truncated text), and a control
 * carries its own `IconButton` tooltip.
 */
const SELF_EXPLAINING = 'time, button, a[href], [role="button"]';

/**
 * The lines of text a reader would see if the cell were wide enough.
 *
 * Leaf elements rather than the container: a two-line cell ("Q4 2026" over "Due 06 Sept 2026")
 * has children that each truncate on their own, so the container never overflows even though both
 * lines are clipped. Reading the leaves gets both, and keeps them as separate lines in the
 * tooltip instead of running them together.
 */
function cellLines(root: HTMLElement): string[] {
  const leaves = Array.from(root.querySelectorAll<HTMLElement>('*')).filter(
    (n) => n.children.length === 0 && (n.textContent ?? '').trim() !== '',
  );
  const texts = leaves.length > 0 ? leaves : [root];
  return [...new Set(texts.map((n) => (n.textContent ?? '').trim()).filter(Boolean))];
}

/**
 * A table cell that offers its full text on hover — but only when the text is actually cut off
 * (FRONTEND_STANDARDS §3.11).
 *
 * The condition is the whole point. A tooltip on text that already fits repeats what the reader
 * can see, which is the `title`-attribute habit this design system exists to avoid. So the cell
 * measures itself and stays silent when nothing is clipped.
 *
 * It measures on hover and focus, never on mount. A hundred rows of seven columns is seven hundred
 * layout reads, and doing them up front would undo the virtualization the table does to stay
 * responsive on the machines this runs on (§7).
 */
function TruncatedCell({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<string[] | null>(null);

  const measure = () => {
    const el = ref.current;
    if (!el) return;
    if (el.querySelector(SELF_EXPLAINING)) {
      setLines(null);
      return;
    }
    // +1 absorbs the sub-pixel difference a fractional layout leaves behind.
    const nodes = [el, ...Array.from(el.querySelectorAll<HTMLElement>('*'))];
    const clipped = nodes.some((n) => n.scrollWidth > n.clientWidth + 1);
    setLines(clipped ? cellLines(el) : null);
  };

  return (
    <Tooltip
      block
      className="w-full"
      content={
        lines && lines.length > 0 ? (
          <span className="block">
            {lines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </span>
        ) : null
      }
    >
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- nothing happens on
          these events except a measurement: the cell asks whether its own text is clipped, so that
          a tooltip is offered only when there is something the reader cannot already see. */}
      <div ref={ref} onMouseEnter={measure} onFocus={measure} className="truncate">
        {children}
      </div>
    </Tooltip>
  );
}

/**
 * The single listing table (FRONTEND_STANDARDS §3.11). Callers supply a column config and the
 * rows; loading, refreshing, empty, and error states are handled here so no screen re-implements
 * them.
 *
 * What the primitive owns, so that a page never has to:
 *
 *  - **A sticky header** inside the table's own scroll viewport, so column meaning stays on
 *    screen through a thousand rows.
 *  - **Virtualization** above `VIRTUALIZE_ABOVE` rows. At 100 rows per page the DOM stays small
 *    and scrolling stays smooth on the low-powered machines this is used on.
 *  - **Selection** and the header select-all, scoped to the visible page and stated as such.
 *  - **Row click-through**, so a record is one click away rather than hidden behind a button in
 *    the last column.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  refreshing,
  error,
  onRetry,
  emptyMessage = 'Nothing to show yet.',
  emptyAction,
  sort,
  order = 'desc',
  onSortChange,
  density = 'comfortable',
  onRowClick,
  activeRowKey,
  selectable,
  selectedKeys,
  onSelectionChange,
  isRowSelectable,
}: DataTableProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  const rowHeight = ROW_HEIGHT[density];
  const virtualize = rows.length > VIRTUALIZE_ABOVE;

  // Measure the scroll viewport so the virtual window knows how many rows fit.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !virtualize) return;
    const observer = new ResizeObserver(() => setViewport(el.clientHeight));
    observer.observe(el);
    setViewport(el.clientHeight);
    return () => observer.disconnect();
  }, [virtualize]);

  // A new page of rows starts at the top — otherwise page 2 opens halfway down (§3.10).
  // Assigning `scrollTop` rather than calling `scrollTo` because the property is universal while
  // the method isn't: `?.` guards a null ref, not a missing method, so `scrollTo` threw outright
  // in environments that don't implement it.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [rows]);

  const window_ = useMemo(() => {
    if (!virtualize) return { start: 0, end: rows.length, padTop: 0, padBottom: 0 };
    const visibleCount = Math.ceil((viewport || 600) / rowHeight);
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
    const end = Math.min(rows.length, start + visibleCount + OVERSCAN * 2);
    return {
      start,
      end,
      padTop: start * rowHeight,
      padBottom: (rows.length - end) * rowHeight,
    };
  }, [virtualize, rows.length, viewport, scrollTop, rowHeight]);

  const selectableRows = useMemo(
    () => (isRowSelectable ? rows.filter(isRowSelectable) : rows),
    [rows, isRowSelectable],
  );
  const selectedOnPage = selectableRows.filter((r) => selectedKeys?.has(rowKey(r))).length;
  const allOnPageSelected = selectableRows.length > 0 && selectedOnPage === selectableRows.length;

  const toggleAll = () => {
    const next = new Set(selectedKeys ?? []);
    if (allOnPageSelected) selectableRows.forEach((r) => next.delete(rowKey(r)));
    else selectableRows.forEach((r) => next.add(rowKey(r)));
    onSelectionChange?.(next);
  };

  const toggleRow = (row: T) => {
    const key = rowKey(row);
    const next = new Set(selectedKeys ?? []);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectionChange?.(next);
  };

  if (loading) return <SkeletonTable columns={columns.length} />;

  if (error) {
    return (
      <div className="p-6">
        <Alert tone="danger">
          <p>We couldn&apos;t load this list. Check your connection and try again.</p>
          {onRetry && (
            <div className="mt-3">
              <Button variant="secondary" size="sm" onClick={onRetry} icon={RefreshCw}>
                Try again
              </Button>
            </div>
          )}
        </Alert>
      </div>
    );
  }

  if (rows.length === 0) return <EmptyState message={emptyMessage} action={emptyAction} />;

  const totalColumns = columns.length + (selectable ? 1 : 0);

  const renderHeader = (col: Column<T>) => {
    const sortable = !!col.sortKey && !!onSortChange;
    if (!sortable) return col.header;
    const active = col.sortKey === sort;
    const next: SortOrder = active && order === 'asc' ? 'desc' : 'asc';
    return (
      <button
        type="button"
        onClick={() => onSortChange!(col.sortKey!, next)}
        className={`inline-flex items-center gap-1 font-medium uppercase tracking-wide hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 ${
          col.align === 'right' ? 'flex-row-reverse' : ''
        }`}
      >
        {col.header}
        {/* Spoken state, not just an arrow — an icon announces nothing (§6). */}
        <span className="sr-only">
          {active
            ? `, sorted ${order === 'asc' ? 'ascending' : 'descending'}. Activate to sort ${next === 'asc' ? 'ascending' : 'descending'}`
            : ', not sorted. Activate to sort ascending'}
        </span>
        {active ? (
          order === 'asc' ? (
            <ArrowUp size={12} className="text-brand" aria-hidden />
          ) : (
            <ArrowDown size={12} className="text-brand" aria-hidden />
          )
        ) : (
          <ChevronsUpDown size={12} className="text-gray-300" aria-hidden />
        )}
      </button>
    );
  };

  const visibleRows = rows.slice(window_.start, window_.end);

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => virtualize && setScrollTop(e.currentTarget.scrollTop)}
      // The table's own scroll viewport: it fills the space the list shell gives it, scrolls
      // internally so the toolbar and header stay put, and contains its scroll so reaching the
      // last row doesn't start moving the page behind it (§3.10).
      className={`min-h-0 flex-1 overflow-auto overscroll-contain transition-opacity ${
        refreshing ? 'opacity-60' : ''
      }`}
      aria-busy={refreshing || undefined}
    >
      {/*
        `min-w` is load-bearing, not decoration. With `table-fixed`, once the declared column
        widths add up to more than the container, the browser takes the space back from whichever
        columns *didn't* declare one — squeezing them to nothing and letting their header text
        spill over the next column. (That's how "TEMPLATE" ended up printed on top of "PERIOD".)
        A minimum width means the table scrolls horizontally inside its own viewport instead,
        which is what §3.8 asks for: the table scrolls sideways, the page never does.
      */}
      <table className="w-full min-w-[64rem] table-fixed text-sm">
        <colgroup>
          {selectable && <col style={{ width: '3rem' }} />}
          {columns.map((col, i) => (
            <col
              key={col.id ?? col.header ?? i}
              style={col.width ? { width: col.width } : undefined}
            />
          ))}
        </colgroup>

        <thead className="sticky top-0 z-10 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 shadow-[inset_0_-1px_0_theme(colors.gray.200)]">
          <tr>
            {selectable && (
              <th scope="col" className={cellPadding[density]}>
                <Checkbox
                  checked={allOnPageSelected}
                  indeterminate={selectedOnPage > 0 && !allOnPageSelected}
                  onChange={toggleAll}
                  aria-label={
                    allOnPageSelected
                      ? 'Clear the selection on this page'
                      : 'Select every row on this page'
                  }
                />
              </th>
            )}
            {columns.map((col, i) => {
              const active = col.sortKey && col.sortKey === sort;
              return (
                <th
                  key={col.id ?? col.header ?? i}
                  scope="col"
                  aria-sort={
                    col.sortKey && onSortChange
                      ? active
                        ? order === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                      : undefined
                  }
                  // A header truncates like its cells do. Without this a long column name
                  // overflows its box and prints across the header beside it.
                  className={`truncate ${cellPadding[density]} ${
                    col.align === 'right' ? 'text-right' : ''
                  } ${col.hideOnMobile ? 'hidden sm:table-cell' : ''} ${col.className ?? ''}`}
                >
                  {renderHeader(col)}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody className="divide-y divide-gray-100">
          {window_.padTop > 0 && (
            <tr aria-hidden style={{ height: window_.padTop }}>
              <td colSpan={totalColumns} />
            </tr>
          )}

          {visibleRows.map((row) => {
            const key = rowKey(row);
            const selected = selectedKeys?.has(key) ?? false;
            const clickable = !!onRowClick;
            return (
              <tr
                key={key}
                onClick={
                  clickable
                    ? (e) => {
                        if (startedOnAControl(e.target, e.currentTarget)) return;
                        onRowClick(row);
                      }
                    : undefined
                }
                // The row is not a control. It used to carry `role="button"` and a tab stop,
                // which read well in isolation and was wrong twice over: a row full of action
                // buttons became a button containing buttons, and the `button` role replaced the
                // row's own semantics, so a screen reader stopped saying which row and column it
                // was in. The keyboard path now lives on the first cell, which is a real button
                // with the record's own name on it — "Q1 2026" rather than "row".
                aria-selected={selectable ? selected : undefined}
                className={`${clickable ? 'cursor-pointer' : ''} ${
                  key === activeRowKey
                    ? 'bg-brand-50'
                    : selected
                      ? 'bg-brand-50/60'
                      : 'hover:bg-gray-50'
                }`}
                style={virtualize ? { height: rowHeight } : undefined}
              >
                {selectable && (
                  <td
                    className={cellPadding[density]}
                    // Selecting must not also open the record.
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      checked={selected}
                      disabled={isRowSelectable ? !isRowSelectable(row) : false}
                      onChange={() => toggleRow(row)}
                      aria-label="Select this row"
                    />
                  </td>
                )}
                {columns.map((col, i) => {
                  const content = col.noTooltip ? (
                    col.cell(row)
                  ) : (
                    <TruncatedCell>{col.cell(row)}</TruncatedCell>
                  );
                  return (
                    <td
                      key={col.id ?? col.header ?? i}
                      className={`${cellPadding[density]} ${
                        col.align === 'right' ? 'text-right' : ''
                      } ${col.hideOnMobile ? 'hidden sm:table-cell' : ''} ${col.className ?? ''}`}
                    >
                      {clickable && i === 0 ? (
                        // The row's keyboard equivalent. It sits on the first column because that
                        // is where the record identifies itself, so the tab stop announces the
                        // thing it opens instead of announcing "button".
                        <button
                          type="button"
                          onClick={() => onRowClick(row)}
                          className="block w-full min-w-0 text-left focus:outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-brand"
                        >
                          {content}
                        </button>
                      ) : (
                        content
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}

          {window_.padBottom > 0 && (
            <tr aria-hidden style={{ height: window_.padBottom }}>
              <td colSpan={totalColumns} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
