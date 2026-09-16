import { api } from './api';
import type {
  EnforcementCase,
  EnforcementOrder,
  EnforcementOrderType,
  EnforcementReason,
  EnforcementStatus,
  Paginated,
} from './types';

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

export interface DraftOrderInput {
  type: EnforcementOrderType;
  reason: string;
  legalBasis: string;
  effectiveFrom: string;
  /** Omitted for a cancellation, which does not run for a period. */
  durationDays?: number;
}

export interface ApproveOrderInput {
  /** Required for a cancellation: the Board minute that authorised it, and the day it was taken. */
  boardMinuteRef?: string;
  boardDecidedAt?: string;
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

  /** The formal orders on a case. Readable by the operator it is against, as well as by staff. */
  orders: (caseId: string) =>
    api.get<EnforcementOrder[]>(`/enforcement/${caseId}/orders`).then((r) => r.data),

  draftOrder: (caseId: string, input: DraftOrderInput) =>
    api.post<EnforcementOrder>(`/enforcement/${caseId}/orders`, input).then((r) => r.data),

  approveOrder: (orderId: string, input: ApproveOrderInput = {}) =>
    api
      .patch<EnforcementOrder>(`/enforcement/orders/${orderId}/approve`, input)
      .then((r) => r.data),

  revokeOrder: (orderId: string, note: string) =>
    api
      .patch<EnforcementOrder>(`/enforcement/orders/${orderId}/revoke`, { note })
      .then((r) => r.data),
};

export const enforcementKeys = {
  all: ['enforcement'] as const,
  list: (params: EnforcementListParams) => ['enforcement', 'list', params] as const,
  orders: (caseId: string) => ['enforcement', 'orders', caseId] as const,
};
