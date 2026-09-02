import { api } from './api';
import type { Entity, EntityListRow, EntityStatus, EntityType, Paginated } from './types';

export interface EntityListParams {
  page?: number;
  pageSize?: number;
  sort?: 'createdAt' | 'name' | 'type' | 'status';
  order?: 'asc' | 'desc';
  type?: EntityType;
  status?: EntityStatus;
  search?: string;
}

export interface EntityInput {
  name: string;
  type: EntityType;
  licenceNumber: string;
  licenceIssuedAt?: string;
  yearsInOperation?: number;
  geographicScope?: string;
  headquartersAddress?: string;
  primaryContactName?: string;
  primaryContactTitle?: string;
  primaryContactEmail?: string;
  primaryContactPhone?: string;
}

export const entitiesApi = {
  list: (params: EntityListParams) =>
    api.get<Paginated<EntityListRow>>('/entities', { params }).then((r) => r.data),

  get: (id: string) => api.get<Entity>(`/entities/${id}`).then((r) => r.data),

  create: (body: EntityInput) => api.post<Entity>('/entities', body).then((r) => r.data),

  update: (id: string, body: Partial<EntityInput>) =>
    api.patch<Entity>(`/entities/${id}`, body).then((r) => r.data),

  setStatus: (id: string, status: EntityStatus) =>
    api.patch<Entity>(`/entities/${id}/status`, { status }).then((r) => r.data),

  remove: (id: string) => api.delete<{ message: string }>(`/entities/${id}`).then((r) => r.data),
};

/** Centralized query keys — mutations invalidate by prefix. */
export const entityKeys = {
  all: ['entities'] as const,
  list: (params: EntityListParams) => ['entities', 'list', params] as const,
  detail: (id: string) => ['entities', 'detail', id] as const,
};
