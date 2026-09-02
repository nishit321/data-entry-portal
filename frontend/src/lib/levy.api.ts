import { api } from './api';
import type { LevyAssessment, LevyRate } from './types';

export interface LevyRateInput {
  ratePercent: number;
  effectiveFrom: string;
  effectiveTo?: string;
  label?: string;
}

export interface LevyAssessmentParams {
  periodId?: string;
  entityId?: string;
}

export const levyApi = {
  listRates: () => api.get<LevyRate[]>('/levy/rates').then((r) => r.data),

  createRate: (input: LevyRateInput) =>
    api.post<LevyRate>('/levy/rates', input).then((r) => r.data),

  updateRate: (id: string, input: Partial<LevyRateInput>) =>
    api.patch<LevyRate>(`/levy/rates/${id}`, input).then((r) => r.data),

  removeRate: (id: string) =>
    api.delete<{ message: string }>(`/levy/rates/${id}`).then((r) => r.data),

  assessments: (params: LevyAssessmentParams = {}) =>
    api.get<LevyAssessment>('/levy/assessments', { params }).then((r) => r.data),
};

export const levyKeys = {
  all: ['levy'] as const,
  rates: ['levy', 'rates'] as const,
  assessments: (params: LevyAssessmentParams) => ['levy', 'assessments', params] as const,
};
