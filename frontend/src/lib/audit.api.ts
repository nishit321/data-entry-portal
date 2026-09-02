import { api } from './api';
import type { AuditAction, AuditLogRow, Paginated } from './types';

export type { AuditLogRow } from './types';

export interface AuditListParams {
  page?: number;
  pageSize?: number;
  sort?: 'createdAt' | 'action';
  order?: 'asc' | 'desc';
  action?: AuditAction;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  /** Inclusive created-date range, yyyy-mm-dd. */
  from?: string;
  to?: string;
}

export const auditApi = {
  list: (params: AuditListParams) =>
    api.get<Paginated<AuditLogRow>>('/audit', { params }).then((r) => r.data),
};

export const auditKeys = {
  all: ['audit'] as const,
  list: (params: AuditListParams) => ['audit', 'list', params] as const,
};
