import { api } from './api';
import type { Agent, Paginated } from './types';

export interface AgentListParams {
  page?: number;
  pageSize?: number;
  sort?: 'createdAt' | 'name' | 'agentReference' | 'isActive';
  order?: 'asc' | 'desc';
  entityId?: string;
  isActive?: boolean;
  search?: string;
}

export interface AgentInput {
  agentReference: string;
  name: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  isActive?: boolean;
  /** Authority callers only; operators are scoped to their own entity server-side. */
  entityId?: string;
}

export const agentsApi = {
  list: (params: AgentListParams) =>
    api.get<Paginated<Agent>>('/agents', { params }).then((r) => r.data),

  create: (body: AgentInput) => api.post<Agent>('/agents', body).then((r) => r.data),

  update: (id: string, body: Partial<AgentInput>) =>
    api.patch<Agent>(`/agents/${id}`, body).then((r) => r.data),

  remove: (id: string) => api.delete<{ message: string }>(`/agents/${id}`).then((r) => r.data),
};

export const agentKeys = {
  all: ['agents'] as const,
  list: (params: AgentListParams) => ['agents', 'list', params] as const,
};
