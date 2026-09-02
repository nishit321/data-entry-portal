import { api } from './api';
import type {
  Complaint,
  ComplaintCategory,
  ComplaintStatus,
  ComplaintTracking,
  Paginated,
} from './types';

export interface FileComplaintInput {
  category: ComplaintCategory;
  subject: string;
  description: string;
  complainantName?: string;
  complainantEmail?: string;
  complainantPhone?: string;
  aboutEntityId?: string;
}

/** What the citizen is given once, on filing. The tracking code is never shown again. */
export interface FiledComplaint {
  referenceNumber: string;
  trackingCode: string;
  message: string;
}

export interface ComplaintListParams {
  page?: number;
  pageSize?: number;
  sort?: 'createdAt' | 'status' | 'category';
  order?: 'asc' | 'desc';
  status?: ComplaintStatus;
  category?: ComplaintCategory;
  aboutEntityId?: string;
  search?: string;
}

export const complaintsApi = {
  /** Public: no token required. */
  file: (input: FileComplaintInput) =>
    api.post<FiledComplaint>('/complaints', input).then((r) => r.data),

  /** Public: the reference alone is not enough, the tracking code must match. */
  track: (referenceNumber: string, trackingCode: string) =>
    api
      .post<ComplaintTracking>('/complaints/track', { referenceNumber, trackingCode })
      .then((r) => r.data),

  list: (params: ComplaintListParams) =>
    api.get<Paginated<Complaint>>('/complaints', { params }).then((r) => r.data),

  get: (id: string) => api.get<Complaint>(`/complaints/${id}`).then((r) => r.data),

  updateStatus: (id: string, status: ComplaintStatus, resolutionNote?: string) =>
    api
      .patch<Complaint>(`/complaints/${id}/status`, { status, resolutionNote })
      .then((r) => r.data),
};

export const complaintKeys = {
  all: ['complaints'] as const,
  list: (params: ComplaintListParams) => ['complaints', 'list', params] as const,
};
