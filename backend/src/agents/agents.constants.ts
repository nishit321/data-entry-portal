import { Prisma } from '@prisma/client';

/** Columns returned for an agent. */
export const publicAgentSelect = {
  id: true,
  entityId: true,
  agentReference: true,
  name: true,
  location: true,
  latitude: true,
  longitude: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  // Owning entity's name, so Authority listings can show which operator an agent
  // belongs to. Operators only ever see their own, so it is redundant but harmless.
  entity: { select: { name: true } },
} satisfies Prisma.AgentSelect;

/** Columns a list may be sorted by (allow-list — never a raw client string). */
export const AGENT_SORT_COLUMNS = ['createdAt', 'name', 'agentReference', 'isActive'] as const;
export type AgentSortColumn = (typeof AGENT_SORT_COLUMNS)[number];
