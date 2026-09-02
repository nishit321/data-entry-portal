import { api } from './api';
import type { SigningCertificate, SignatureVerification } from './types';

export const signaturesApi = {
  listCertificates: () =>
    api.get<SigningCertificate[]>('/signatures/certificates').then((r) => r.data),

  register: (input: { label: string; certificatePem: string }) =>
    api.post<SigningCertificate>('/signatures/certificates', input).then((r) => r.data),

  revoke: (id: string) =>
    api.delete<{ message: string }>(`/signatures/certificates/${id}`).then((r) => r.data),

  /** What to sign. Anyone can compute the same value from the return itself. */
  digest: (submissionId: string) =>
    api
      .get<{ digest: string }>(`/signatures/returns/${submissionId}/digest`)
      .then((r) => r.data.digest),

  verify: (submissionId: string) =>
    api
      .get<SignatureVerification>(`/signatures/returns/${submissionId}/verify`)
      .then((r) => r.data),
};

export const signaturesKeys = {
  all: ['signatures'] as const,
  certificates: ['signatures', 'certificates'] as const,
  verify: (id: string) => ['signatures', 'verify', id] as const,
};
