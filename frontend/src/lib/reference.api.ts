import { api } from './api';
import type { Paginated, ReferenceCategory, ReferenceItem } from './types';

export interface ReferenceListParams {
  page?: number;
  pageSize?: number;
  sort?: 'sortOrder' | 'label' | 'code' | 'createdAt';
  order?: 'asc' | 'desc';
  category?: ReferenceCategory;
  isActive?: boolean;
  search?: string;
}

export interface ReferenceItemInput {
  category: ReferenceCategory;
  code: string;
  label: string;
  description?: string;
  sortOrder?: number;
}

export const referenceApi = {
  categories: () => api.get<ReferenceCategory[]>('/reference-data/categories').then((r) => r.data),

  lookup: (category: ReferenceCategory) =>
    api.get<ReferenceItem[]>(`/reference-data/lookup/${category}`).then((r) => r.data),

  list: (params: ReferenceListParams) =>
    api.get<Paginated<ReferenceItem>>('/reference-data', { params }).then((r) => r.data),

  create: (body: ReferenceItemInput) =>
    api.post<ReferenceItem>('/reference-data', body).then((r) => r.data),

  update: (
    id: string,
    body: Partial<{ label: string; description: string; sortOrder: number; isActive: boolean }>,
  ) => api.patch<ReferenceItem>(`/reference-data/${id}`, body).then((r) => r.data),

  remove: (id: string) =>
    api.delete<{ message: string }>(`/reference-data/${id}`).then((r) => r.data),
};

export const referenceKeys = {
  all: ['reference-data'] as const,
  list: (params: ReferenceListParams) => ['reference-data', 'list', params] as const,
};
