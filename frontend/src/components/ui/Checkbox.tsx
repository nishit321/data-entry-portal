import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The themed checkbox (FRONTEND_STANDARDS §3.9). Screens used to write
 * `<input type="checkbox" className="h-4 w-4 accent-brand">` inline in three different places,
 * which is exactly the drift §3.4 exists to stop.
 *
 * It keeps the real `<input>` underneath — the native control carries the role, the keyboard
 * behaviour, and the indeterminate state for free — and styles it with `accent-color` rather than
 * replacing it with a `<div>` that looks like a checkbox and behaves like nothing.
 */
export function Checkbox({
  checked,
  onChange,
  label,
  hint,
  disabled,
  indeterminate,
  id,
  name,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Renders a clickable label beside the box. Omit for a bare box (a table select column). */
  label?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  /** "Some but not all" — the select-all box when part of a page is selected. */
  indeterminate?: boolean;
  id?: string;
  name?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}) {
  const ref = useRef<HTMLInputElement>(null);

  // `indeterminate` is a DOM property with no HTML attribute, so it can only be set this way.
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate && !checked;
  }, [indeterminate, checked]);

  const input = (
    <input
      ref={ref}
      id={id}
      name={name}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4 shrink-0 cursor-pointer accent-brand disabled:cursor-not-allowed disabled:opacity-50"
    />
  );

  if (!label) return input;

  return (
    <label
      className={`flex items-start gap-2 text-sm ${
        disabled ? 'cursor-not-allowed text-gray-500' : 'cursor-pointer text-gray-700'
      }`}
    >
      <span className="flex h-5 items-center">{input}</span>
      <span>
        {label}
        {hint && <span className="block text-xs text-gray-500">{hint}</span>}
      </span>
    </label>
  );
}
