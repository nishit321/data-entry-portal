import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

/**
 * The single search field (FRONTEND_STANDARDS §3.9): leading search icon, placeholder,
 * debounced change, and a clear (×) affordance once populated. Sits at the left of the
 * filters row on every list. Controlled on `value`; `onChange` fires debounced.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  id,
  debounceMs = 300,
  'aria-label': ariaLabel = 'Search',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  debounceMs?: number;
  'aria-label'?: string;
}) {
  const [local, setLocal] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep in sync if the parent resets the value (e.g. filter cleared elsewhere).
  useEffect(() => {
    setLocal(value);
  }, [value]);

  const push = (next: string) => {
    setLocal(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange(next), debounceMs);
  };

  const clear = () => {
    // Focus returns to the field so the user can type a new query straight away, rather than
    // being left with focus on a button that has just removed itself.
    inputRef.current?.focus();
    clearTimeout(timer.current);
    setLocal('');
    onChange('');
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div className="relative">
      <Search
        size={16}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
        aria-hidden
      />
      <input
        ref={inputRef}
        id={id}
        type="search"
        role="searchbox"
        aria-label={ariaLabel}
        value={local}
        onChange={(e) => push(e.target.value)}
        placeholder={placeholder}
        className="block w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-9 text-sm text-gray-900 shadow-sm transition placeholder:text-gray-500 focus-visible:border-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 [&::-webkit-search-cancel-button]:hidden"
      />
      {local && (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-500 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}
