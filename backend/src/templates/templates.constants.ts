import { Prisma } from '@prisma/client';

/** Light row for the template list, with a section count. */
export const templateListSelect = {
  id: true,
  name: true,
  version: true,
  status: true,
  publishedAt: true,
  updatedAt: true,
  _count: { select: { sections: true } },
} satisfies Prisma.ReportingTemplateSelect;

/** Full template with ordered sections, their ordered fields, and its rules. */
export const templateDetailInclude = {
  sections: {
    orderBy: { order: 'asc' },
    include: { fields: { orderBy: { order: 'asc' } } },
  },
  rules: { orderBy: { order: 'asc' } },
} satisfies Prisma.ReportingTemplateInclude;

/** Columns a template list may be sorted by (allow-list). */
export const TEMPLATE_SORT_COLUMNS = [
  'name',
  'version',
  'status',
  'createdAt',
  'updatedAt',
] as const;
export type TemplateSortColumn = (typeof TEMPLATE_SORT_COLUMNS)[number];
