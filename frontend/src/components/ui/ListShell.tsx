import { useEffect, useState, type ReactNode } from 'react';
import { Filter, Rows2, Rows3, X } from 'lucide-react';
import type { PaginationMeta } from '../../lib/types';
import { announce } from '../../hooks/usePageMeta';
import { usePreference } from '../../hooks/usePreference';
import { BELOW_LG, useMediaQuery } from '../../hooks/useMediaQuery';
import type { Density } from '../DataTable';
import { Button } from './Button';
import { Drawer } from './Drawer';
import { FilterField } from './FilterField';
import { Pagination } from './Pagination';
import { SearchInput } from './SearchInput';
import { Tooltip } from './Tooltip';

export interface ActiveFilterChip {
  key: string;
  /** What the user sees on the chip — the *label*, never a raw id. */
  label: string;
  onRemove: () => void;
}

/**
 * The frame every list screen is built inside (FRONTEND_STANDARDS §3.11).
 *
 * The layout it enforces, and why each part is here:
 *
 *  - **The toolbar sticks.** Search and filters stay on screen while rows scroll. Before this they
 *    sat in normal page flow, so at a hundred rows a user had to scroll past all of them to change
 *    a filter.
 *  - **Every toolbar control is a `FilterField`**, search included, so they share one label rhythm
 *    and bottom-align. A labelled filter next to an unlabelled search box cannot line up.
 *  - **The table fills the rest and scrolls itself**, which is what lets its header stay put — and
 *    what keeps the pagination bar under it permanently on screen, so it isn't repeated up here.
 *  - **Active filters are named back to the user** as removable chips, so what is narrowing the
 *    view is legible without opening each dropdown in turn.
 *  - **The result count is live**, announced to screen readers when it changes (§6).
 *  - **Filters collapse into a drawer on small screens**, where a six-filter row is unusable.
 *  - **Density is a user preference**, remembered across screens and sessions (§3.13).
 */
export function ListShell({
  header,
  search,
  filters,
  activeFilters = [],
  onClearFilters,
  actions,
  meta,
  onPageChange,
  onPageSizeChange,
  refreshing,
  selectionBar,
  children,
  densityKey = 'table-density',
  onDensityChange,
  footnote,
}: {
  /** The `PageHeader` for this screen. */
  header?: ReactNode;
  search?: { value: string; onChange: (value: string) => void; placeholder: string; label: string };
  /** The filter controls. Laid out here; the screen supplies the controls themselves. */
  filters?: ReactNode;
  activeFilters?: ActiveFilterChip[];
  onClearFilters?: () => void;
  /** Extra toolbar actions on the right — export, column settings. */
  actions?: ReactNode;
  meta?: PaginationMeta;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  refreshing?: boolean;
  /** Replaces the toolbar while rows are selected (§3.11). */
  selectionBar?: ReactNode;
  /** The `DataTable`. */
  children: ReactNode;
  densityKey?: string;
  onDensityChange?: (density: Density) => void;
  /** Small explanatory line under the table. */
  footnote?: ReactNode;
}) {
  const [density, setDensity] = usePreference<Density>(densityKey, 'comfortable');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const isSmall = useMediaQuery(BELOW_LG);

  useEffect(() => {
    onDensityChange?.(density);
  }, [density, onDensityChange]);

  // Speak the result count when it changes, so a filter's effect is available to someone who
  // can't see the table (§6).
  useEffect(() => {
    if (!meta) return;
    announce(`${meta.total.toLocaleString()} ${meta.total === 1 ? 'record' : 'records'} found`);
  }, [meta?.total]); // eslint-disable-line react-hooks/exhaustive-deps

  const filterCount = activeFilters.length;

  const toolbar = selectionBar ?? (
    <div className="space-y-3">
      {/*
        One row, aligned on `items-end`.

        `items-end` rather than `items-center` is the whole fix: the filters carry labels and the
        search box does not, so centring them lines up the *wrappers* and leaves the controls
        themselves stepped up and down the row. Bottom-aligning lines up the controls, which is
        what the eye actually reads. The search is wrapped in the same `FilterField` as every
        filter, so it carries a label too and the row has one rhythm rather than two.
      */}
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        {search && (
          <FilterField label={search.label} width="xl">
            {({ id }) => (
              <SearchInput
                id={id}
                value={search.value}
                onChange={search.onChange}
                placeholder={search.placeholder}
                aria-label={search.label}
              />
            )}
          </FilterField>
        )}

        {/* Below `lg` the filters live behind a button; a six-control row on a phone is a wall. */}
        {filters && isSmall && (
          <Button variant="secondary" icon={Filter} onClick={() => setFiltersOpen(true)}>
            Filters
            {filterCount > 0 && (
              <span className="ml-1.5 rounded-full bg-brand-50 px-1.5 text-xs text-brand-700">
                {filterCount}
              </span>
            )}
          </Button>
        )}

        {filters && !isSmall && filters}

        {/*
          Table controls, pinned right. `ml-auto` keeps them right-aligned even when the row wraps
          and they end up on a line of their own.

          There is deliberately no pagination here any more. The full control is pinned directly
          under the table's scroll viewport, so it is on screen at every scroll position already —
          repeating the range and the per-page selector in the toolbar just showed the same two
          numbers twice on the same screen.
        */}
        <div className="ml-auto flex items-end gap-2">
          {actions}
          <Tooltip content={density === 'comfortable' ? 'Compact rows' : 'Comfortable rows'}>
            <button
              type="button"
              onClick={() => setDensity(density === 'comfortable' ? 'compact' : 'comfortable')}
              aria-label={density === 'comfortable' ? 'Compact rows' : 'Comfortable rows'}
              // Matches the control height exactly (px-3 py-2 text-sm + border = 38px), so it
              // sits level with the search box and the filters rather than a couple of pixels off.
              className="inline-flex h-[2.375rem] w-[2.375rem] items-center justify-center rounded-md border border-gray-300 bg-white text-gray-500 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {density === 'comfortable' ? <Rows2 size={16} /> : <Rows3 size={16} />}
            </button>
          </Tooltip>
        </div>
      </div>

      {filterCount > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeFilters.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-1 pl-2.5 pr-1 text-xs text-brand-800"
            >
              {chip.label}
              <button
                type="button"
                onClick={chip.onRemove}
                aria-label={`Remove the ${chip.label} filter`}
                className="rounded-full p-0.5 text-brand-600 hover:bg-brand-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <X size={12} />
              </button>
            </span>
          ))}
          {onClearFilters && (
            <button
              type="button"
              onClick={onClearFilters}
              className="rounded px-2 py-1 text-xs font-medium text-gray-500 underline-offset-2 hover:text-gray-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6 lg:px-8 lg:pt-6">
        {header}

        {/* Sticky toolbar: the whole point of the shell (§3.11). */}
        <div className="sticky top-0 z-20 -mx-4 bg-gray-50/95 px-4 pb-3 pt-1 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          {toolbar}
        </div>

        {/* The table's own bounded viewport. `min-h-0` is what allows it to shrink and scroll
            instead of pushing the toolbar off the top (§3.10). */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {children}
          {meta && onPageChange && (
            <div className="shrink-0">
              <Pagination
                meta={meta}
                onPageChange={onPageChange}
                onPageSizeChange={onPageSizeChange}
              />
            </div>
          )}
        </div>

        {footnote && <div className="shrink-0 pb-2">{footnote}</div>}
      </div>

      <Drawer
        open={filtersOpen && isSmall}
        title="Filters"
        description={refreshing ? 'Updating…' : undefined}
        onClose={() => setFiltersOpen(false)}
        footer={
          <div className="flex justify-between gap-2">
            {onClearFilters && (
              <Button variant="secondary" onClick={onClearFilters}>
                Clear all
              </Button>
            )}
            <Button className="ml-auto" onClick={() => setFiltersOpen(false)}>
              Show results
            </Button>
          </div>
        }
      >
        <div className="space-y-4">{filters}</div>
      </Drawer>
    </div>
  );
}
