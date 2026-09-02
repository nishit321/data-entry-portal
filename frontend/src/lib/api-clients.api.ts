import { api } from './api';
import type { ApiClient, ApiClientWithSecret, ApiScope, ApiClientStatus } from './types';

export interface ApiClientInput {
  entityId?: string;
  name: string;
  scopes: ApiScope[];
  certFingerprint?: string;
  allowedCidrs?: string[];
  rateLimitPerMinute?: number;
  expiresAt?: string;
}

export interface ApiClientUpdate {
  name?: string;
  scopes?: ApiScope[];
  certFingerprint?: string;
  allowedCidrs?: string[];
  rateLimitPerMinute?: number;
  status?: ApiClientStatus;
  expiresAt?: string;
}

export const apiClientsApi = {
  list: () => api.get<ApiClient[]>('/api-clients').then((r) => r.data),

  /** The only response that ever carries the secret. It cannot be fetched again. */
  create: (input: ApiClientInput) =>
    api.post<ApiClientWithSecret>('/api-clients', input).then((r) => r.data),

  update: (id: string, input: ApiClientUpdate) =>
    api.patch<ApiClient>(`/api-clients/${id}`, input).then((r) => r.data),

  rotate: (id: string) =>
    api.post<ApiClientWithSecret>(`/api-clients/${id}/rotate`).then((r) => r.data),

  revoke: (id: string) => api.delete<{ message: string }>(`/api-clients/${id}`).then((r) => r.data),
};

export const apiClientKeys = {
  all: ['api-clients'] as const,
};
