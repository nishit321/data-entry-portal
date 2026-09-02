import { api } from './api';
import type { Paginated, PeriodFrequency, PeriodStatus, ReportingPeriod } from './types';

export interface PeriodListParams {
  page?: number;
  pageSize?: number;
  sort?: 'dueDate' | 'label' | 'frequency' | 'status' | 'periodStart' | 'createdAt';
  order?: 'asc' | 'desc';
  templateId?: string;
  status?: PeriodStatus;
  frequency?: PeriodFrequency;
  search?: string;
}

export interface PeriodInput {
  templateId: string;
  frequency: PeriodFrequency;
  label: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  graceDays?: number;
  status?: 'SCHEDULED' | 'OPEN';
}

export const periodsApi = {
  list: (params: PeriodListParams) =>
    api.get<Paginated<ReportingPeriod>>('/reporting-periods', { params }).then((r) => r.data),

  get: (id: string) => api.get<ReportingPeriod>(`/reporting-periods/${id}`).then((r) => r.data),

  create: (body: PeriodInput) =>
    api.post<ReportingPeriod>('/reporting-periods', body).then((r) => r.data),

  update: (id: string, body: Partial<Omit<PeriodInput, 'templateId' | 'frequency' | 'status'>>) =>
    api.patch<ReportingPeriod>(`/reporting-periods/${id}`, body).then((r) => r.data),

  open: (id: string) =>
    api.post<ReportingPeriod>(`/reporting-periods/${id}/open`, {}).then((r) => r.data),

  close: (id: string) =>
    api.post<ReportingPeriod>(`/reporting-periods/${id}/close`, {}).then((r) => r.data),

  remove: (id: string) =>
    api.delete<{ message: string }>(`/reporting-periods/${id}`).then((r) => r.data),
};

export const periodKeys = {
  all: ['reporting-periods'] as const,
  list: (params: PeriodListParams) => ['reporting-periods', 'list', params] as const,
  detail: (id: string) => ['reporting-periods', 'detail', id] as const,
};
