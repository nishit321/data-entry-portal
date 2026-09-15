import { api } from './api';
import type {
  FibreLink,
  MapReport,
  NetworkSite,
  NetworkSiteKind,
  NetworkSiteStatus,
  Paginated,
  RoutePoint,
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

export interface FibreLinkListParams {
  page?: number;
  pageSize?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  search?: string;
  entityId?: string;
  status?: NetworkSiteStatus;
}

export interface FibreLinkInput {
  entityId?: string;
  linkReference: string;
  name: string;
  fromSiteId: string;
  toSiteId: string;
  status?: NetworkSiteStatus;
  lengthKm?: number;
  capacityGbps?: number;
  /** Send an empty array to take a surveyed route off and go back to the straight line. */
  path?: RoutePoint[];
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

  get: (id: string) => api.get<NetworkSite>(`/geo/sites/${id}`).then((r) => r.data),

  create: (input: NetworkSiteInput) =>
    api.post<NetworkSite>('/geo/sites', input).then((r) => r.data),

  update: (id: string, input: Partial<NetworkSiteInput>) =>
    api.patch<NetworkSite>(`/geo/sites/${id}`, input).then((r) => r.data),

  remove: (id: string) => api.delete<{ message: string }>(`/geo/sites/${id}`).then((r) => r.data),

  /** Fibre routes: the lines between nodes that the map draws. */
  listLinks: (params: FibreLinkListParams = {}) =>
    api.get<Paginated<FibreLink>>('/geo/links', { params }).then((r) => r.data),

  createLink: (input: FibreLinkInput) =>
    api.post<FibreLink>('/geo/links', input).then((r) => r.data),

  updateLink: (id: string, input: Partial<FibreLinkInput>) =>
    api.patch<FibreLink>(`/geo/links/${id}`, input).then((r) => r.data),

  removeLink: (id: string) =>
    api.delete<{ message: string }>(`/geo/links/${id}`).then((r) => r.data),
};

export const geoKeys = {
  all: ['geo'] as const,
  map: (params: MapParams) => ['geo', 'map', params] as const,
  sites: (params: NetworkSiteListParams) => ['geo', 'sites', params] as const,
  links: (params: FibreLinkListParams) => ['geo', 'links', params] as const,
};
