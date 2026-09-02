import { api } from './api';
import type {
  Paginated,
  ReportingFrequency,
  Submission,
  SubmissionListRow,
  SubmissionStatus,
  ValidationResult,
  WorkbookUploadReport,
} from './types';

/** An open period the operator can still start a return for (see startablePeriods). */
export interface StartablePeriod {
  id: string;
  label: string;
  frequency: ReportingFrequency;
  dueDate: string;
  template: { id: string; name: string; version: number };
}

export interface SubmissionListParams {
  page?: number;
  pageSize?: number;
  sort?: 'createdAt' | 'submittedAt' | 'status' | 'referenceNumber';
  order?: 'asc' | 'desc';
  status?: SubmissionStatus;
  periodId?: string;
  entityId?: string;
  templateId?: string;
  isLate?: boolean;
  /** Inclusive submitted-date range, yyyy-mm-dd. */
  submittedFrom?: string;
  submittedTo?: string;
  search?: string;
}

export interface SubmissionValueInput {
  fieldId: string;
  valueText?: string;
  isUnavailable?: boolean;
  unavailableReason?: string;
  otherText?: string;
}

export const submissionsApi = {
  list: (params: SubmissionListParams) =>
    api.get<Paginated<SubmissionListRow>>('/submissions', { params }).then((r) => r.data),

  get: (id: string) => api.get<Submission>(`/submissions/${id}`).then((r) => r.data),

  /** Open periods the operator can still start (none begun yet, template fits their entity type). */
  startablePeriods: () =>
    api.get<StartablePeriod[]>('/submissions/startable-periods').then((r) => r.data),

  /** Create or resume the operator's draft for a period. */
  openDraft: (periodId: string) =>
    api.post<Submission>('/submissions', { periodId }).then((r) => r.data),

  saveValues: (id: string, values: SubmissionValueInput[]) =>
    api.put<Submission>(`/submissions/${id}/values`, { values }).then((r) => r.data),

  /** Dry-run: validate the saved values and return the two-tier issues without submitting. */
  validate: (id: string) =>
    api.post<ValidationResult>(`/submissions/${id}/validate`, {}).then((r) => r.data),

  submit: (id: string, signedName: string) =>
    api.post<Submission>(`/submissions/${id}/submit`, { signedName }).then((r) => r.data),

  /** Revise a rejected return into a fresh draft (new version); returns the new draft. */
  revise: (id: string) => api.post<Submission>(`/submissions/${id}/revise`, {}).then((r) => r.data),

  remove: (id: string) => api.delete<{ message: string }>(`/submissions/${id}`).then((r) => r.data),

  /**
   * Download the return as a workbook to fill in offline. Fetched through the API client rather
   * than a plain link, because the download needs the bearer token.
   */
  downloadWorkbook: async (id: string, fallbackName = 'return.xlsx') => {
    const res = await api.get<Blob>(`/submissions/${id}/workbook`, { responseType: 'blob' });
    const match = /filename="?([^"]+)"?/.exec(String(res.headers['content-disposition'] ?? ''));
    const url = URL.createObjectURL(res.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = match?.[1] ?? fallbackName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },

  /** Load a filled workbook into the draft; returns what went in and what did not. */
  uploadWorkbook: (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api
      .post<WorkbookUploadReport>(`/submissions/${id}/workbook`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
  },
};

export const submissionKeys = {
  all: ['submissions'] as const,
  /**
   * Prefix for every list query. Use this — not `all` — when a mutation should refresh the lists
   * but must NOT disturb an open detail: `all` prefix-matches `detail`, so invalidating it while
   * someone is filling the form refetches underneath them and reseeds over their typing.
   */
  lists: ['submissions', 'list'] as const,
  list: (params: SubmissionListParams) => ['submissions', 'list', params] as const,
  detail: (id: string) => ['submissions', 'detail', id] as const,
};
