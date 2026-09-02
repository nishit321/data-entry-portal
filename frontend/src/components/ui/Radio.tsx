import type { ReactNode } from 'react';

export interface RadioOption<T extends string> {
  value: T;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}

/**
 * Single choice from a short, visible set (FRONTEND_STANDARDS §3.9). Use this over a `Select`
 * when the options are few and worth reading at a glance — the choice is then one click, not two,
 * and the alternatives are visible while deciding.
 *
 * The group is a real `radiogroup`, so arrow keys move between options the way a keyboard user
 * expects (§6).
 */
export function RadioGroup<T extends string>({
  value,
  onChange,
  options,
  name,
  direction = 'vertical',
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
}: {
  value: T;
  onChange: (value: T) => void;
  options: RadioOption<T>[];
  name: string;
  direction?: 'vertical' | 'horizontal';
  'aria-label'?: string;
  'aria-describedby'?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      className={direction === 'vertical' ? 'space-y-2' : 'flex flex-wrap gap-4'}
    >
      {options.map((opt) => (
        <label
          key={opt.value}
          className={`flex items-start gap-2 text-sm ${
            opt.disabled ? 'cursor-not-allowed text-gray-500' : 'cursor-pointer text-gray-700'
          }`}
        >
          <span className="flex h-5 items-center">
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={value === opt.value}
              disabled={opt.disabled}
              onChange={() => onChange(opt.value)}
              className="h-4 w-4 shrink-0 cursor-pointer accent-brand disabled:cursor-not-allowed disabled:opacity-50"
            />
          </span>
          <span>
            {opt.label}
            {opt.hint && <span className="block text-xs text-gray-500">{opt.hint}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}
