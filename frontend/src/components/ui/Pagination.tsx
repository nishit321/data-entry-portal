import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from 'lucide-react';
import type { PaginationMeta } from '../../lib/types';
import { PAGE_SIZE_OPTIONS } from '../../hooks/useListParams';
import { Select } from './Select';

export { PAGE_SIZE_OPTIONS };

const PAGE_SIZE_SELECT_OPTIONS = PAGE_SIZE_OPTIONS.map((n) => ({
  value: String(n),
  label: String(n),
}));

const navBtn =
  'inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand';

/**
 * The single pagination control, driven by the backend `meta` (FRONTEND_STANDARDS §3.9).
 *
 * It sits pinned directly under the table's scroll viewport, which means it is on screen at every
 * scroll position — the reason the toolbar does not carry a second copy of the range and the
 * per-page selector (§3.11).
 */
export function Pagination({
  meta,
  onPageChange,
  onPageSizeChange,
}: {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
}) {
  if (meta.total === 0) return null;
  const from = (meta.page - 1) * meta.pageSize + 1;
  const to = Math.min(meta.page * meta.pageSize, meta.total);

  const range = (
    <span className="whitespace-nowrap text-gray-500">
      <span className="font-medium text-gray-700">
        {from.toLocaleString()} to {to.toLocaleString()}
      </span>{' '}
      of {meta.total.toLocaleString()}
    </span>
  );

  const sizeSelector = onPageSizeChange && (
    <div className="flex items-center gap-1.5">
      <span className="hidden text-gray-500 sm:inline">Per page</span>
      <Select
        className="w-[4.75rem]"
        aria-label="Rows per page"
        value={String(meta.pageSize)}
        options={PAGE_SIZE_SELECT_OPTIONS}
        searchable={false}
        onChange={(value) => onPageSizeChange(Number(value))}
      />
    </div>
  );

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-col gap-3 border-t border-gray-100 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-center gap-4">
        {range}
        {sizeSelector}
      </div>

      <div className="flex items-center gap-1.5">
        <button
          className={navBtn}
          disabled={!meta.hasPrev}
          onClick={() => onPageChange(1)}
          aria-label="First page"
        >
          <ChevronFirst size={16} />
        </button>
        <button
          className={navBtn}
          disabled={!meta.hasPrev}
          onClick={() => onPageChange(meta.page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="px-2 text-gray-500">
          Page {meta.page} of {meta.totalPages}
        </span>
        <button
          className={navBtn}
          disabled={!meta.hasNext}
          onClick={() => onPageChange(meta.page + 1)}
          aria-label="Next page"
        >
          <ChevronRight size={16} />
        </button>
        <button
          className={navBtn}
          disabled={!meta.hasNext}
          onClick={() => onPageChange(meta.totalPages)}
          aria-label="Last page"
        >
          <ChevronLast size={16} />
        </button>
      </div>
    </nav>
  );
}
