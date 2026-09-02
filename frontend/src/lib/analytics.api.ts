import { api } from './api';
import type { AnalyticsSummary, AnalyticsTrends, AnomalyReport, AnomalySeverity } from './types';

export interface AnalyticsFilters {
  entityId?: string;
  templateId?: string;
  periodId?: string;
}

export interface AnomalyFilters extends AnalyticsFilters {
  severity?: AnomalySeverity;
  thresholdPercent?: number;
  limit?: number;
  includeFirstReports?: boolean;
}

export const analyticsApi = {
  summary: (filters: AnalyticsFilters = {}) =>
    api.get<AnalyticsSummary>('/analytics/summary', { params: filters }).then((r) => r.data),

  trends: (filters: AnalyticsFilters & { periods?: number } = {}) =>
    api.get<AnalyticsTrends>('/analytics/trends', { params: filters }).then((r) => r.data),

  anomalies: (filters: AnomalyFilters = {}) =>
    api.get<AnomalyReport>('/analytics/anomalies', { params: filters }).then((r) => r.data),
};

export const analyticsKeys = {
  all: ['analytics'] as const,
  summary: (filters: AnalyticsFilters) => ['analytics', 'summary', filters] as const,
  trends: (filters: AnalyticsFilters & { periods?: number }) =>
    ['analytics', 'trends', filters] as const,
  anomalies: (filters: AnomalyFilters) => ['analytics', 'anomalies', filters] as const,
};
