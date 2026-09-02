import { api } from './api';
import type {
  EntityType,
  PublicAggregation,
  PublicComplaintsSummary,
  PublicIndicator,
  PublicIndicatorReport,
} from './types';

export interface PublicIndicatorInput {
  fieldKey: string;
  aggregation?: PublicAggregation;
  label: string;
  unit?: string;
  description?: string;
  order?: number;
  isPublished?: boolean;
}

export interface PublicOverview {
  licensedOperators: number;
  byType: { type: EntityType; count: number }[];
  periodsPublished: number;
}

export interface PublishableField {
  fieldKey: string;
  label: string;
  unit: string | null;
  section: string;
  template: string;
}

/** The open-data endpoints. No token is sent; these are readable by anyone. */
export const publicPortalApi = {
  overview: () => api.get<PublicOverview>('/public/overview').then((r) => r.data),

  indicators: (periods?: number) =>
    api
      .get<PublicIndicatorReport>('/public/indicators', { params: { periods } })
      .then((r) => r.data),

  complaintsSummary: () =>
    api.get<PublicComplaintsSummary>('/public/complaints-summary').then((r) => r.data),
};

/** Deciding what the public sees. Authority reads; only an administrator writes. */
export const publicIndicatorsApi = {
  list: () => api.get<PublicIndicator[]>('/public-indicators').then((r) => r.data),

  available: () =>
    api
      .get<{ fields: PublishableField[] }>('/public-indicators/available')
      .then((r) => r.data.fields),

  create: (input: PublicIndicatorInput) =>
    api.post<PublicIndicator>('/public-indicators', input).then((r) => r.data),

  update: (id: string, input: Partial<PublicIndicatorInput>) =>
    api.patch<PublicIndicator>(`/public-indicators/${id}`, input).then((r) => r.data),

  remove: (id: string) =>
    api.delete<{ message: string }>(`/public-indicators/${id}`).then((r) => r.data),
};

export const publicPortalKeys = {
  all: ['public-portal'] as const,
  overview: ['public-portal', 'overview'] as const,
  indicators: (periods?: number) => ['public-portal', 'indicators', periods] as const,
  complaints: ['public-portal', 'complaints'] as const,
  admin: ['public-indicators'] as const,
  available: ['public-indicators', 'available'] as const,
};
