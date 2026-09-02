import type { ReactNode } from 'react';

/**
 * The content-area header row (FRONTEND_STANDARDS §3.6).
 *
 * `meta` and `actions` are separate slots on purpose. They had been one, so a screen's version
 * number and status badge ended up in the same cluster as its buttons — a row that mixed things
 * you *read* with things you *press*, at different heights, and pushed the buttons around as the
 * badge text changed. They are different kinds of thing:
 *
 *  - **`meta`** describes the record — a version, a status badge, a reference number. It belongs
 *    beside the title, because that's what it qualifies.
 *  - **`actions`** are the buttons. One primary action, everything else secondary (§3.6), pinned
 *    right and never wrapping into the title's space.
 */
export function PageHeader({
  title,
  description,
  meta,
  actions,
}: {
  title?: string;
  description?: string;
  /** Badges and identifiers that describe the record. Rendered beside the title. */
  meta?: ReactNode;
  /** Buttons only. */
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {(title || meta) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {title && <h2 className="text-xl font-semibold text-gray-900">{title}</h2>}
            {meta}
          </div>
        )}
        {description && <p className="mt-1 max-w-3xl text-sm text-gray-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
