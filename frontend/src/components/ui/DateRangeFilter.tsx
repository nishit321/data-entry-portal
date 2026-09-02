import { useMemo } from 'react';
import { DatePicker } from './DatePicker';
import { FilterField } from './FilterField';
import { Select, type SelectOption } from './Select';

export interface DateRange {
  from: string;
  to: string;
}

type PresetId = 'custom' | 'today' | 'last7' | 'last30' | 'thisMonth' | 'lastMonth' | 'thisYear';

const PRESET_OPTIONS: SelectOption[] = [
  { value: 'custom', label: 'Any date' },
  { value: 'today', label: 'Today' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'lastMonth', label: 'Last month' },
  { value: 'thisYear', label: 'This year' },
];

function iso(date: Date): string {
  // Local calendar date, not UTC: `toISOString` would roll "today" back a day for anyone east of
  // Greenwich in the evening, which is precisely where this portal is used.
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function rangeFor(preset: PresetId, today = new Date()): DateRange {
  const start = new Date(today);
  switch (preset) {
    case 'today':
      return { from: iso(today), to: iso(today) };
    case 'last7':
      start.setDate(start.getDate() - 6);
      return { from: iso(start), to: iso(today) };
    case 'last30':
      start.setDate(start.getDate() - 29);
      return { from: iso(start), to: iso(today) };
    case 'thisMonth':
      return { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today) };
    case 'lastMonth': {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const last = new Date(today.getFullYear(), today.getMonth(), 0);
      return { from: iso(first), to: iso(last) };
    }
    case 'thisYear':
      return { from: iso(new Date(today.getFullYear(), 0, 1)), to: iso(today) };
    default:
      return { from: '', to: '' };
  }
}

/**
 * A date range with the ranges people actually ask for (FRONTEND_STANDARDS §3.11).
 *
 * "Show me the last 7 days" is by far the most common thing anyone wants from an audit trail, and
 * making them open two calendars and count backwards to express it is needless. The explicit
 * from/to pickers stay for everything else, and the preset resolves to the same two values — so
 * there's one filter here, not two competing ones.
 */
export function DateRangeFilter({
  value,
  onChange,
  label = 'Date range',
  fromLabel = 'From',
  toLabel = 'To',
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  label?: string;
  fromLabel?: string;
  toLabel?: string;
}) {
  // Reflect back which preset the current dates correspond to, so a shared link that carries an
  // explicit range still shows "Last 7 days" when that's what it is.
  const activePreset = useMemo<PresetId>(() => {
    if (!value.from && !value.to) return 'custom';
    for (const option of PRESET_OPTIONS) {
      const id = option.value as PresetId;
      if (id === 'custom') continue;
      const range = rangeFor(id);
      if (range.from === value.from && range.to === value.to) return id;
    }
    return 'custom';
  }, [value.from, value.to]);

  // No wrapper element: the three controls are siblings of the other filters in the toolbar row,
  // so they wrap and bottom-align with them. Nesting them in their own flex box made the group
  // move as one block and break the row's rhythm (§3.11).
  return (
    <>
      <FilterField label={label} width="md">
        {({ id }) => (
          <Select
            id={id}
            aria-label={label}
            value={activePreset}
            options={PRESET_OPTIONS}
            searchable={false}
            onChange={(next) => onChange(rangeFor(next as PresetId))}
          />
        )}
      </FilterField>
      <FilterField label={fromLabel} width="sm">
        {({ id }) => (
          <DatePicker
            id={id}
            aria-label={fromLabel}
            value={value.from}
            max={value.to || undefined}
            onChange={(from) => onChange({ ...value, from })}
          />
        )}
      </FilterField>
      <FilterField label={toLabel} width="sm">
        {({ id }) => (
          <DatePicker
            id={id}
            aria-label={toLabel}
            value={value.to}
            min={value.from || undefined}
            onChange={(to) => onChange({ ...value, to })}
          />
        )}
      </FilterField>
    </>
  );
}
