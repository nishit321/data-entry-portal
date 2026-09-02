import { api } from './api';
import type {
  MapReport,
  NetworkSite,
  NetworkSiteKind,
  NetworkSiteStatus,
  Paginated,
} from './types';

export interface NetworkSiteListParams {
  page?: number;
  pageSize?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  search?: string;
  entityId?: string;
  kind?: NetworkSiteKind;
  status?: NetworkSiteStatus;
}

export interface NetworkSiteInput {
  entityId?: string;
  siteReference: string;
  name: string;
  kind?: NetworkSiteKind;
  status?: NetworkSiteStatus;
  latitude: number;
  longitude: number;
  location?: string;
  technology?: string;
  coverageM?: number;
  commissionedAt?: string;
}

export interface MapParams {
  entityId?: string;
  kind?: NetworkSiteKind;
  status?: NetworkSiteStatus;
  includeAgents?: boolean;
  limit?: number;
}

export const geoApi = {
  map: (params: MapParams = {}) => api.get<MapReport>('/geo/map', { params }).then((r) => r.data),

  list: (params: NetworkSiteListParams = {}) =>
    api.get<Paginated<NetworkSite>>('/geo/sites', { params }).then((r) => r.data),

  create: (input: NetworkSiteInput) =>
    api.post<NetworkSite>('/geo/sites', input).then((r) => r.data),

  update: (id: string, input: Partial<NetworkSiteInput>) =>
    api.patch<NetworkSite>(`/geo/sites/${id}`, input).then((r) => r.data),

  remove: (id: string) => api.delete<{ message: string }>(`/geo/sites/${id}`).then((r) => r.data),
};

export const geoKeys = {
  all: ['geo'] as const,
  map: (params: MapParams) => ['geo', 'map', params] as const,
  sites: (params: NetworkSiteListParams) => ['geo', 'sites', params] as const,
};
