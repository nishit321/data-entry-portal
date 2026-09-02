import { api } from './api';
import type { EnforcementCase, EnforcementReason, EnforcementStatus, Paginated } from './types';

export interface EnforcementListParams {
  page?: number;
  pageSize?: number;
  sort?: 'openedAt' | 'createdAt' | 'status';
  order?: 'asc' | 'desc';
  status?: EnforcementStatus;
  reason?: EnforcementReason;
  entityId?: string;
  periodId?: string;
}

export interface SweepResult {
  periodsSwept: number;
  casesOpened: number;
}

export const enforcementApi = {
  list: (params: EnforcementListParams) =>
    api.get<Paginated<EnforcementCase>>('/enforcement', { params }).then((r) => r.data),

  /** Run the compliance sweep across every period whose grace window has ended. */
  sweep: () => api.post<SweepResult>('/enforcement/sweep').then((r) => r.data),

  resolve: (id: string, note?: string) =>
    api.patch<EnforcementCase>(`/enforcement/${id}/resolve`, { note }).then((r) => r.data),

  waive: (id: string, note?: string) =>
    api.patch<EnforcementCase>(`/enforcement/${id}/waive`, { note }).then((r) => r.data),
};

export const enforcementKeys = {
  all: ['enforcement'] as const,
  list: (params: EnforcementListParams) => ['enforcement', 'list', params] as const,
};
