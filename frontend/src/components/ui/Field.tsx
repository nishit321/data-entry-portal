import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Tooltip } from './Tooltip';

/** What `Field` hands a control so the hint and error text are actually associated with it. */
export interface FieldControlProps {
  id?: string;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
}

/**
 * Low-level label + control + error scaffold. Most forms use `FormField` (which wires
 * RHF error state and `aria-invalid` for you); reach for `Field` only for controls that
 * manage their own invalid state.
 *
 * Use `hint` for guidance that should always be visible below the label; use `info` when the
 * note is secondary and would otherwise misalign a control against its neighbour in a row — it
 * tucks the text into a hover/focus tooltip on a small ℹ icon beside the label instead.
 *
 * **The hint and the error are attached to the control, not merely printed under it.** Rendering
 * them as loose paragraphs makes them visible and nothing more: a screen reader announces the
 * label and stops, so the person who most needs "one per line, e.g. 203.0.113.0/24" is the one
 * who never hears it. `aria-describedby` is set here rather than at every call site, because a
 * rule that has to be remembered eighty times is a rule that will be missed.
 */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  info,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  info?: string;
  required?: boolean;
  /** The control. A function receives the props to spread when cloning cannot reach it. */
  children: ReactNode | ((field: FieldControlProps) => ReactNode);
}) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  const field: FieldControlProps = {
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
  };

  /**
   * Attach the description to the control.
   *
   * A single element child is cloned, which is what every call site passes and what keeps this
   * working without touching them. Anything already carrying its own `aria-describedby` is left
   * alone — `FormField`'s render form sets it, and overwriting it there would drop whichever id
   * it had chosen. Anything else (a fragment, several controls) needs the function form, since
   * there is no single control to describe.
   */
  const control = (() => {
    if (typeof children === 'function') return children(field);
    const only = Children.count(children) === 1 ? Children.only(children) : null;
    if (!only || !isValidElement(only)) return children;
    const own = only.props as FieldControlProps;
    return cloneElement(only as ReactElement<FieldControlProps>, {
      'aria-describedby': own['aria-describedby'] ?? describedBy,
      'aria-invalid': own['aria-invalid'] ?? field['aria-invalid'],
    });
  })();

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700">
          {label}
          {required && <span className="ml-0.5 text-danger-600">*</span>}
        </label>
        {info && (
          <Tooltip content={info}>
            <button
              type="button"
              tabIndex={0}
              aria-label={`About ${label}`}
              className="flex text-gray-500 transition-colors hover:text-gray-600 focus:outline-none focus-visible:text-gray-600"
            >
              <Info size={14} aria-hidden />
            </button>
          </Tooltip>
        )}
      </div>
      {hint && (
        <p id={hintId} className="text-xs text-gray-500">
          {hint}
        </p>
      )}
      {control}
      {error && (
        // `alert` so the message reaches a screen reader the moment validation puts it there.
        // Without it a submit that fails is silent: the form simply does not go anywhere.
        <p id={errorId} role="alert" className="text-sm font-medium text-danger-600">
          {error}
        </p>
      )}
    </div>
  );
}
