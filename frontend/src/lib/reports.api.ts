import { api } from './api';
import type { ReportSchedule, ReportFrequency, ScheduledReportKind } from './types';

export interface ReportScheduleInput {
  name: string;
  kind?: ScheduledReportKind;
  frequency?: ReportFrequency;
  dayOfPeriod?: number;
  hour?: number;
  isEnabled?: boolean;
  /** Authority staff by id. The API refuses anyone else, and there is no address field. */
  recipientIds?: string[];
}

export const reportsApi = {
  list: () => api.get<ReportSchedule[]>('/report-schedules').then((r) => r.data),

  create: (input: ReportScheduleInput) =>
    api.post<ReportSchedule>('/report-schedules', input).then((r) => r.data),

  update: (id: string, input: Partial<ReportScheduleInput>) =>
    api.patch<ReportSchedule>(`/report-schedules/${id}`, input).then((r) => r.data),

  send: (id: string) =>
    api
      .post<{ sent: number; recipients: number }>(`/report-schedules/${id}/send`)
      .then((r) => r.data),

  remove: (id: string) =>
    api.delete<{ message: string }>(`/report-schedules/${id}`).then((r) => r.data),
};

export const reportsKeys = {
  all: ['report-schedules'] as const,
};
