import { useId, type ReactNode } from 'react';

/** The widths a toolbar control is allowed to take. Free values would drift screen to screen. */
const WIDTHS = {
  sm: 'w-full sm:w-40',
  md: 'w-full sm:w-48',
  lg: 'w-full sm:w-56',
  xl: 'w-full sm:w-64',
} as const;

export type FilterWidth = keyof typeof WIDTHS;

/**
 * One labelled control in a list toolbar (FRONTEND_STANDARDS §3.11).
 *
 * This exists to fix an alignment defect, and the defect is instructive: every list screen was
 * hand-writing the same `<div class="w-full sm:w-56"><span class="mb-1 block text-xs…">` wrapper
 * around its filter, while the search box next to them had no label at all. Mixing labelled and
 * unlabelled controls in one row means their *controls* can't line up — the labelled ones sit a
 * label's height lower. Ten copies of the wrapper also meant ten chances for the widths to drift.
 *
 * So the wrapper is a primitive, every toolbar control uses it (search included), and the row
 * aligns on `items-end` — which lines the controls up regardless of how tall the labels are.
 */
export function FilterField({
  label,
  children,
  width = 'md',
  htmlFor,
}: {
  label: string;
  /** The control. Receives the generated id when `htmlFor` isn't supplied by the caller. */
  children: ReactNode | ((props: { id: string }) => ReactNode);
  width?: FilterWidth;
  htmlFor?: string;
}) {
  const generatedId = useId();
  const id = htmlFor ?? generatedId;

  return (
    <div className={WIDTHS[width]}>
      <label htmlFor={id} className="mb-1 block truncate text-xs font-medium text-gray-500">
        {label}
      </label>
      {typeof children === 'function' ? children({ id }) : children}
    </div>
  );
}
