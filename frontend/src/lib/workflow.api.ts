import { api } from './api';
import type {
  Paginated,
  ReviewDecision,
  ReviewHistory,
  Submission,
  SubmissionListRow,
} from './types';

export interface WorkflowQueueParams {
  page?: number;
  pageSize?: number;
  sort?: 'submittedAt' | 'createdAt' | 'referenceNumber';
  order?: 'asc' | 'desc';
  entityId?: string;
  templateId?: string;
  periodId?: string;
  isLate?: boolean;
  search?: string;
}

export const workflowApi = {
  /** The returns waiting at the caller's review stage (paginated + filterable). */
  queue: (params: WorkflowQueueParams) =>
    api.get<Paginated<SubmissionListRow>>('/workflow/queue', { params }).then((r) => r.data),

  /** Record an approve/reject decision at the caller's stage; returns the updated submission. */
  decide: (id: string, decision: ReviewDecision, comment?: string) =>
    api.post<Submission>(`/workflow/${id}/decision`, { decision, comment }).then((r) => r.data),

  /** The full review timeline of a return (Authority-only). */
  history: (id: string) => api.get<ReviewHistory>(`/workflow/${id}/history`).then((r) => r.data),
};

export const workflowKeys = {
  all: ['workflow'] as const,
  queue: (params: WorkflowQueueParams) => ['workflow', 'queue', params] as const,
  history: (id: string) => ['workflow', 'history', id] as const,
};
