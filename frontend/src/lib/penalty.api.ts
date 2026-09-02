import { api } from './api';
import type { EntityType, PenaltyRule } from './types';

export interface PenaltyRuleInput {
  reason?: string;
  entityType?: EntityType;
  fixedAmount?: number;
  dailyAmount?: number;
  maxAmount?: number;
  label?: string;
  effectiveFrom: string;
  effectiveTo?: string;
}

export const penaltyApi = {
  list: () => api.get<PenaltyRule[]>('/penalty-schedule').then((r) => r.data),

  create: (input: PenaltyRuleInput) =>
    api.post<PenaltyRule>('/penalty-schedule', input).then((r) => r.data),

  update: (id: string, input: Partial<PenaltyRuleInput>) =>
    api.patch<PenaltyRule>(`/penalty-schedule/${id}`, input).then((r) => r.data),

  remove: (id: string) =>
    api.delete<{ message: string }>(`/penalty-schedule/${id}`).then((r) => r.data),

  /** Bring open cases up to date now rather than waiting for the nightly run. */
  accrue: () =>
    api
      .post<{ cases: number; accrued: number; closed: number }>('/enforcement/accrue')
      .then((r) => r.data),
};

export const penaltyKeys = {
  all: ['penalty-schedule'] as const,
};
