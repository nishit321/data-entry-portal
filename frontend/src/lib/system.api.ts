import { api } from './api';

/**
 * Liveness is deliberately version-neutral on the server (`/api/health`), so it sits one level
 * above the versioned base the rest of the client uses. Derive it rather than hard-coding a host.
 */
const HEALTH_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1').replace(
  /\/v\d+\/?$/,
  '/health',
);

/** One background job's schedule and what its last run did. */
export interface JobStatus {
  name: 'compliance-sweep' | 'document-expiry' | 'notification-retry';
  cron: string;
  running: boolean;
  lastRun: {
    name: string;
    startedAt: string;
    finishedAt: string;
    ok: boolean;
    summary: string;
  } | null;
}

export interface SchedulerStatus {
  enabled: boolean;
  jobs: JobStatus[];
}

export interface HealthStatus {
  status: 'ok' | 'degraded';
  database: 'up' | 'down';
  timestamp: string;
}

export const systemApi = {
  scheduler: () => api.get<SchedulerStatus>('/scheduler/status').then((r) => r.data),

  runJob: (name: JobStatus['name']) =>
    api.post<JobStatus['lastRun']>(`/scheduler/jobs/${name}/run`).then((r) => r.data),

  health: () => api.get<HealthStatus>(HEALTH_URL).then((r) => r.data),
};

export const systemKeys = {
  all: ['system'] as const,
  scheduler: ['system', 'scheduler'] as const,
  health: ['system', 'health'] as const,
};
