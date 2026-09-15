import { Prisma, ReportingFrequency } from '@prisma/client';

/** Frequencies valid for a single reporting period (not the section-level combo). */
export const PERIOD_FREQUENCIES: ReportingFrequency[] = [
  ReportingFrequency.MONTHLY,
  ReportingFrequency.QUARTERLY,
  ReportingFrequency.ANNUAL,
];

/** Row/detail view — includes the parent template's name/version for display. */
/**
 * SSP per USD used for the very first reporting period, before there is one to carry forward.
 *
 * NCA's figure, given on 3 September 2026, not an estimate of ours. It is only ever the starting
 * point: every period after the first inherits whatever the previous one used.
 */
export const STARTING_USD_RATE = 7000;

export const periodSelect = {
  id: true,
  templateId: true,
  frequency: true,
  label: true,
  periodStart: true,
  periodEnd: true,
  dueDate: true,
  graceDays: true,
  usdRate: true,
  usdRateAt: true,
  status: true,
  openedAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
  template: { select: { id: true, name: true, version: true } },
} satisfies Prisma.ReportingPeriodSelect;

export const PERIOD_SORT_COLUMNS = [
  'dueDate',
  'label',
  'frequency',
  'status',
  'periodStart',
  'createdAt',
] as const;
export type PeriodSortColumn = (typeof PERIOD_SORT_COLUMNS)[number];
