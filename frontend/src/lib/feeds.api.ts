import { api } from './api';
import type {
  AgreementStatus,
  DataSharingAgreement,
  FeedFrequency,
  FeedMetric,
  FeedRun,
  NetworkFeed,
} from './types';

export interface AgreementInput {
  entityId: string;
  reference: string;
  title: string;
  scope?: string;
  status?: AgreementStatus;
  signedAt?: string;
  startsAt: string;
  endsAt?: string;
}

export interface FeedInput {
  agreementId: string;
  name: string;
  url: string;
  frequency: FeedFrequency;
  hour?: number;
  dayOfWeek?: number;
  isEnabled?: boolean;
  /** Written and never read back; the API does not return it. */
  authToken?: string;
}

export const feedsApi = {
  listAgreements: () => api.get<DataSharingAgreement[]>('/feeds/agreements').then((r) => r.data),

  createAgreement: (input: AgreementInput) =>
    api.post<DataSharingAgreement>('/feeds/agreements', input).then((r) => r.data),

  updateAgreement: (id: string, input: Partial<AgreementInput>) =>
    api.patch<DataSharingAgreement>(`/feeds/agreements/${id}`, input).then((r) => r.data),

  removeAgreement: (id: string) =>
    api.delete<{ message: string }>(`/feeds/agreements/${id}`).then((r) => r.data),

  list: () => api.get<NetworkFeed[]>('/feeds').then((r) => r.data),

  create: (input: FeedInput) => api.post<NetworkFeed>('/feeds', input).then((r) => r.data),

  update: (id: string, input: Partial<FeedInput>) =>
    api.patch<NetworkFeed>(`/feeds/${id}`, input).then((r) => r.data),

  runs: (id: string) => api.get<{ runs: FeedRun[] }>(`/feeds/${id}/runs`).then((r) => r.data.runs),

  run: (id: string) =>
    api
      .post<{ outcome: string; message: string | null; metricCount: number }>(`/feeds/${id}/run`)
      .then((r) => r.data),

  remove: (id: string) => api.delete<{ message: string }>(`/feeds/${id}`).then((r) => r.data),

  /** What the feeds have collected. Telemetry an operator agreed to share, not a filed return. */
  metrics: (params: { entityId?: string; key?: string; limit?: number } = {}) =>
    api
      .get<{ metrics: FeedMetric[]; keys: { key: string; count: number }[] }>('/feeds/metrics', {
        params,
      })
      .then((r) => r.data),
};

export const feedsKeys = {
  all: ['feeds'] as const,
  agreements: ['feeds', 'agreements'] as const,
  list: ['feeds', 'list'] as const,
  runs: (id: string) => ['feeds', 'runs', id] as const,
  metrics: (params: { entityId?: string; key?: string }) => ['feeds', 'metrics', params] as const,
};
