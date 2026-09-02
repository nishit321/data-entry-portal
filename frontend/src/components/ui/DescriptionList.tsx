import type { ReactNode } from 'react';

export interface DescriptionItem {
  label: string;
  value: ReactNode;
  /** Span both columns (e.g. an address). */
  full?: boolean;
}

/**
 * Read-only label/value grid for detail (view) modals. Empty values render as an
 * em dash so the layout stays even. Two columns on wider screens, one on mobile.
 */
export function DescriptionList({ items }: { items: DescriptionItem[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
      {items.map((item) => {
        const empty = item.value === null || item.value === undefined || item.value === '';
        return (
          <div key={item.label} className={item.full ? 'sm:col-span-2' : undefined}>
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {item.label}
            </dt>
            <dd className="mt-0.5 text-sm text-gray-900">{empty ? '—' : item.value}</dd>
          </div>
        );
      })}
    </dl>
  );
}
