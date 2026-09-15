import { api } from './api';
import { saveBlob } from './download';
import type {
  Complaint,
  ComplaintAttachment,
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

  /**
   * Public: attach evidence to a complaint already filed.
   *
   * A second call rather than part of the filing, because filing is the part that must not fail.
   * A citizen who has typed out what happened should not lose it because their photo was the wrong
   * format, so the complaint is recorded first and the file follows against the reference and code
   * it issued. A failed upload then costs the upload and nothing else.
   */
  attach: (referenceNumber: string, trackingCode: string, file: File) => {
    const form = new FormData();
    form.append('referenceNumber', referenceNumber);
    form.append('trackingCode', trackingCode);
    form.append('file', file);
    // Let the browser set the multipart boundary; overriding Content-Type here would break it.
    return api
      .post<ComplaintAttachment>('/complaints/attachments', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
  },

  list: (params: ComplaintListParams) =>
    api.get<Paginated<Complaint>>('/complaints', { params }).then((r) => r.data),

  get: (id: string) => api.get<Complaint>(`/complaints/${id}`).then((r) => r.data),

  updateStatus: (id: string, status: ComplaintStatus, resolutionNote?: string) =>
    api
      .patch<Complaint>(`/complaints/${id}/status`, { status, resolutionNote })
      .then((r) => r.data),

  /** The files on a case. Authority only; there is no public route that reads one back. */
  attachments: (id: string) =>
    api.get<ComplaintAttachment[]>(`/complaints/${id}/attachments`).then((r) => r.data),

  /** Fetch the blob so the browser can save it under the name it was sent with. */
  downloadAttachment: async (id: string, attachment: ComplaintAttachment) => {
    const res = await api.get<Blob>(`/complaints/${id}/attachments/${attachment.id}/download`, {
      responseType: 'blob',
    });
    saveBlob(res.data, attachment.fileName);
  },

  removeAttachment: (id: string, attachmentId: string) =>
    api
      .delete<{ message: string }>(`/complaints/${id}/attachments/${attachmentId}`)
      .then((r) => r.data),
};

export const complaintKeys = {
  all: ['complaints'] as const,
  list: (params: ComplaintListParams) => ['complaints', 'list', params] as const,
  attachments: (id: string) => ['complaints', 'attachments', id] as const,
};
