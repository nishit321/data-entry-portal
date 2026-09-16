import type { SelectOption } from '../components/ui';

/**
 * The hours a scheduled job can run at.
 *
 * Whole hours, and that is the data model rather than a simplification: both `ReportSchedule.hour`
 * and `NetworkFeed.hour` are an integer from 0 to 23. A time picker offering minutes would collect
 * a precision the portal cannot store and would silently drop, which is worse than a list of
 * twenty-four choices that is exactly as precise as the thing behind it.
 *
 * Shared because it was written twice, identically, in two files that schedule two different kinds
 * of job. Two copies of a list is two chances for one of them to start at 1 or stop at 23.
 */
export const HOUR_OPTIONS: SelectOption[] = Array.from({ length: 24 }, (_, i) => ({
  value: String(i),
  label: `${String(i).padStart(2, '0')}:00`,
}));

/** `07:00` from the integer the API stores. */
export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}
