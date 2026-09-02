import { useRef, type ReactNode } from 'react';

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  /** Count shown beside the label — "Drafts 4". Omit rather than passing 0. */
  count?: number;
}

/**
 * Keyboard-navigable tab set (FRONTEND_STANDARDS §3.4). Arrow keys move between tabs, `Home` and
 * `End` jump to the ends, and only the selected tab is in the tab order — the standard pattern, so
 * `Tab` takes the user *into* the panel rather than through every tab in turn (§6).
 *
 * Where a tab changes what data is shown, the caller keeps the selection in the URL via
 * `useListParams` so the view stays shareable (§2).
 */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  'aria-label': ariaLabel,
}: {
  tabs: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  'aria-label'?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  const move = (delta: number) => {
    const index = tabs.findIndex((t) => t.id === value);
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    if (next) {
      onChange(next.id);
      listRef.current?.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      const first = tabs[0];
      if (first) onChange(first.id);
    } else if (e.key === 'End') {
      e.preventDefault();
      const last = tabs[tabs.length - 1];
      if (last) onChange(last.id);
    }
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      // Focusable but not tabbable: the tab stop belongs to the selected tab, and the arrow keys
      // move it between them.
      tabIndex={-1}
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className="flex gap-1 overflow-x-auto overscroll-contain border-b border-gray-200"
    >
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            data-tab={tab.id}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 ${
              selected
                ? 'border-brand text-brand-800'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={`rounded-full px-1.5 text-xs ${
                  selected ? 'bg-brand-50 text-brand-700' : 'bg-gray-100 text-gray-500'
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
