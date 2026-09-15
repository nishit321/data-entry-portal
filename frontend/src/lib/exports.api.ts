import { api } from './api';
import { fileNameFromDisposition, saveBlob } from './download';

/** Filters accepted by the export endpoints (mirroring the screens they come from). */
export interface ExportParams {
  entityId?: string;
  templateId?: string;
  periodId?: string;
}

/**
 * Fetch a generated file and hand it to the browser under the name the server chose.
 *
 * The file has to come through the API client rather than a plain link, because the download needs
 * the bearer token — a bare `<a href>` would arrive unauthenticated and 401.
 */
async function downloadFile(path: string, params: ExportParams, fallbackName: string) {
  const res = await api.get<Blob>(path, { params, responseType: 'blob' });

  // Prefer the server's filename (it carries the generation date) and fall back if absent.
  saveBlob(res.data, fileNameFromDisposition(res.headers['content-disposition'], fallbackName));
}

export const exportsApi = {
  complianceWorkbook: (params: ExportParams = {}) =>
    downloadFile('/exports/compliance.xlsx', params, 'compliance-summary.xlsx'),

  levyWorkbook: (params: ExportParams = {}) =>
    downloadFile('/exports/levy.xlsx', params, 'levy-assessment.xlsx'),

  levyPdf: (params: ExportParams = {}) =>
    downloadFile('/exports/levy.pdf', params, 'levy-assessment.pdf'),
};
