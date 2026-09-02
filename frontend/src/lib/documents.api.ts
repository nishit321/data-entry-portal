import { api } from './api';
import type { DocumentKind, DocumentRecord, Paginated } from './types';

export interface DocumentListParams {
  page?: number;
  pageSize?: number;
  sort?: 'createdAt' | 'expiresAt' | 'title';
  order?: 'asc' | 'desc';
  kind?: DocumentKind;
  entityId?: string;
  search?: string;
  expiringOnly?: boolean;
}

export interface DocumentUploadInput {
  kind: DocumentKind;
  title: string;
  reference?: string;
  issuedAt?: string;
  expiresAt?: string;
  /** Set when replacing an existing document: the version this one supersedes. */
  supersedesId?: string;
  entityId?: string;
  file: File;
}

export const documentsApi = {
  list: (params: DocumentListParams) =>
    api
      .get<Paginated<DocumentRecord>>('/documents', {
        params: { ...params, expiringOnly: params.expiringOnly ? 'true' : undefined },
      })
      .then((r) => r.data),

  upload: ({ file, ...fields }: DocumentUploadInput) => {
    const form = new FormData();
    Object.entries(fields).forEach(([key, value]) => {
      if (value) form.append(key, String(value));
    });
    form.append('file', file);
    // Let the browser set the multipart boundary; overriding Content-Type here would break it.
    return api
      .post<DocumentRecord>('/documents', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
  },

  /** Fetch the blob so the browser can save it under its original file name. */
  download: async (doc: DocumentRecord) => {
    const res = await api.get<Blob>(`/documents/${doc.id}/download`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = doc.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },

  remove: (id: string) => api.delete<{ message: string }>(`/documents/${id}`).then((r) => r.data),

  sweepExpiries: () =>
    api.post<{ checked: number; alerted: number }>('/documents/sweep-expiries').then((r) => r.data),
};

export const documentKeys = {
  all: ['documents'] as const,
  list: (params: DocumentListParams) => ['documents', 'list', params] as const,
};
