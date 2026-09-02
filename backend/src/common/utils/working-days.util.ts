/**
 * Add a number of working days (Mon–Fri) to a date. Used for the reporting-period
 * grace window: a return is accepted (marked "late") for `graceDays` working days
 * after the due date, and is non-compliant thereafter (Q3). Public holidays are
 * not modelled yet — weekends only.
 */
export function addWorkingDays(from: Date, days: number): Date {
  const d = new Date(from);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added += 1; // skip Sun (0) and Sat (6)
  }
  return d;
}
