import { api } from './api';
import { fileNameFromDisposition, saveBlob } from './download';
import type {
  EntityType,
  PublicAggregation,
  PublicComplaintsSummary,
  PublicIndicator,
  PublicIndicatorReport,
  PublicPeriod,
  PublicPortalFilters,
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

  indicators: (periods?: number, filters: PublicPortalFilters = {}) =>
    api
      .get<PublicIndicatorReport>('/public/indicators', { params: { periods, ...filters } })
      .then((r) => r.data),

  /** The closed periods the range filter offers. Drawn before anything has been filtered. */
  periods: () => api.get<PublicPeriod[]>('/public/periods').then((r) => r.data),

  complaintsSummary: () =>
    api.get<PublicComplaintsSummary>('/public/complaints-summary').then((r) => r.data),

  /**
   * Download what the page is showing.
   *
   * The same filters go to the server, which renders the same report the screen was given. A
   * download cannot therefore contain a figure the screen withheld, and that is a property of
   * where the file is built rather than of what this function sends.
   */
  download: async (format: 'xlsx' | 'pdf', filters: PublicPortalFilters = {}) => {
    const res = await api.get<Blob>(`/public/indicators.${format}`, {
      params: filters,
      responseType: 'blob',
    });
    saveBlob(
      res.data,
      fileNameFromDisposition(res.headers['content-disposition'], `sector-figures.${format}`),
    );
  },
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
  indicators: (periods?: number, filters: PublicPortalFilters = {}) =>
    ['public-portal', 'indicators', periods, filters] as const,
  periods: ['public-portal', 'periods'] as const,
  complaints: ['public-portal', 'complaints'] as const,
  admin: ['public-indicators'] as const,
  available: ['public-indicators', 'available'] as const,
};
