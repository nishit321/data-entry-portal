import { forwardRef, useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';
import { controlBase, controlInvalid } from './_styles';

/**
 * Multi-line text on the same tokens as `Input` (FRONTEND_STANDARDS §3.9).
 *
 * This exists because three screens each kept their own `TEXTAREA_CLASS` constant — a copy of the
 * input styling that would drift the first time the token set changed. One primitive, one style.
 *
 * `autoGrow` sizes the box to its content, which matters on the questionnaire: a rejection reason
 * or a reviewer's note is often longer than three rows, and scrolling inside a small box to
 * re-read what you wrote is needless friction.
 */
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & {
    autoGrow?: boolean;
    maxLength?: number;
    /** Shows "120 / 500" under the field. Only useful alongside `maxLength`. */
    showCount?: boolean;
  }
>(function Textarea(
  { className = '', autoGrow, showCount, maxLength, rows = 3, value, onChange, ...props },
  ref,
) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    if (!autoGrow) return;
    const el = innerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [autoGrow, value]);

  const length = typeof value === 'string' ? value.length : 0;

  return (
    <div>
      <textarea
        ref={(node) => {
          innerRef.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        rows={rows}
        value={value}
        maxLength={maxLength}
        onChange={onChange}
        className={`${controlBase} ${controlInvalid} ${autoGrow ? 'resize-none overflow-hidden' : 'resize-y'} ${className}`}
        {...props}
      />
      {showCount && maxLength !== undefined && (
        <p
          className={`mt-1 text-right text-xs ${
            length >= maxLength ? 'text-danger-600' : 'text-gray-500'
          }`}
        >
          {length} / {maxLength}
        </p>
      )}
    </div>
  );
});
