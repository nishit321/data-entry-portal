/**
 * The middle value, or the average of the two middle values.
 *
 * Used wherever a typical figure is wanted from a handful that may include one wild one: a quarter
 * that spiked, a complaint that sat open for a year. A mean lets a single outlier describe the
 * rest; a median does not. Zero for an empty list, so callers decide for themselves whether "no
 * data" should read as a figure at all.
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}
