import { Prisma } from '@prisma/client';

/** Full entity view returned to Authority users and to an entity's own operator. */
export const publicEntitySelect = {
  id: true,
  name: true,
  type: true,
  status: true,
  licenceNumber: true,
  licenceIssuedAt: true,
  yearsInOperation: true,
  geographicScope: true,
  headquartersAddress: true,
  primaryContactName: true,
  primaryContactTitle: true,
  primaryContactEmail: true,
  primaryContactPhone: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.EntitySelect;

/** Lighter row used in list responses, with a live agent count. */
export const entityListSelect = {
  id: true,
  name: true,
  type: true,
  status: true,
  licenceNumber: true,
  licenceIssuedAt: true,
  createdAt: true,
  _count: { select: { agents: { where: { deletedAt: null } } } },
} satisfies Prisma.EntitySelect;

/** Columns a list may be sorted by (allow-list — never a raw client string). */
export const ENTITY_SORT_COLUMNS = ['createdAt', 'name', 'type', 'status'] as const;
export type EntitySortColumn = (typeof ENTITY_SORT_COLUMNS)[number];
