import { api } from './api';
import type {
  ComplianceBenchmark,
  IndicatorBenchmark,
  IndicatorCatalogue,
  EntityType,
} from './types';

export interface BenchmarkFilters {
  entityType?: EntityType;
  entityId?: string;
  templateId?: string;
  periodId?: string;
}

export const benchmarkingApi = {
  compliance: (filters: BenchmarkFilters = {}) =>
    api
      .get<ComplianceBenchmark>('/benchmarking/compliance', { params: filters })
      .then((r) => r.data),

  indicators: (filters: BenchmarkFilters = {}) =>
    api
      .get<IndicatorCatalogue>('/benchmarking/indicators', { params: filters })
      .then((r) => r.data),

  indicator: (filters: BenchmarkFilters & { fieldKey: string }) =>
    api.get<IndicatorBenchmark>('/benchmarking/indicator', { params: filters }).then((r) => r.data),
};

export const benchmarkingKeys = {
  all: ['benchmarking'] as const,
  compliance: (filters: BenchmarkFilters) => ['benchmarking', 'compliance', filters] as const,
  indicators: (filters: BenchmarkFilters) => ['benchmarking', 'indicators', filters] as const,
  indicator: (filters: BenchmarkFilters & { fieldKey: string }) =>
    ['benchmarking', 'indicator', filters] as const,
};
