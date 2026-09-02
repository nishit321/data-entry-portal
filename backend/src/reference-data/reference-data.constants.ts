import { Prisma } from '@prisma/client';

/** Columns returned for a reference item. */
export const publicReferenceSelect = {
  id: true,
  category: true,
  code: true,
  label: true,
  description: true,
  sortOrder: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ReferenceItemSelect;

/** Columns a list may be sorted by (allow-list — never a raw client string). */
export const REFERENCE_SORT_COLUMNS = ['sortOrder', 'label', 'code', 'createdAt'] as const;
export type ReferenceSortColumn = (typeof REFERENCE_SORT_COLUMNS)[number];
