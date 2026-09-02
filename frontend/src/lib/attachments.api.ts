import { api } from './api';
import type { AttachmentKind, SubmissionAttachment } from './types';

export const attachmentsApi = {
  list: (submissionId: string) =>
    api.get<SubmissionAttachment[]>(`/submissions/${submissionId}/attachments`).then((r) => r.data),

  upload: (submissionId: string, kind: AttachmentKind, file: File) => {
    const form = new FormData();
    form.append('kind', kind);
    form.append('file', file);
    // Let the browser set the multipart boundary; overriding Content-Type here would break it.
    return api
      .post<SubmissionAttachment>(`/submissions/${submissionId}/attachments`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
  },

  /** Fetch the blob so the browser can save it under its original file name. */
  download: async (submissionId: string, attachment: SubmissionAttachment) => {
    const res = await api.get<Blob>(
      `/submissions/${submissionId}/attachments/${attachment.id}/download`,
      { responseType: 'blob' },
    );
    const url = URL.createObjectURL(res.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = attachment.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },

  remove: (submissionId: string, attachmentId: string) =>
    api
      .delete<{ message: string }>(`/submissions/${submissionId}/attachments/${attachmentId}`)
      .then((r) => r.data),
};

export const attachmentKeys = {
  all: ['attachments'] as const,
  list: (submissionId: string) => ['attachments', 'list', submissionId] as const,
};
