import { Prisma } from '@prisma/client';

/** Light row for the submissions list. */
export const submissionListSelect = {
  id: true,
  referenceNumber: true,
  status: true,
  reviewStage: true,
  isLate: true,
  submittedAt: true,
  createdAt: true,
  updatedAt: true,
  entity: { select: { id: true, name: true, type: true } },
  period: { select: { id: true, label: true, frequency: true, dueDate: true, status: true } },
  template: { select: { id: true, name: true, version: true } },
  _count: { select: { values: true } },
} satisfies Prisma.SubmissionSelect;

/** Full submission with its answered values + context. */
export const submissionDetailSelect = {
  id: true,
  referenceNumber: true,
  entityId: true,
  periodId: true,
  templateId: true,
  status: true,
  reviewStage: true,
  // Operator-safe review fields: the final rejection reason is shown to operators, but the
  // per-stage reviewer comments are NOT (they live behind the Authority-only review history).
  rejectionReason: true,
  version: true,
  supersedesId: true,
  // Whether a newer version has superseded this one (so the UI can hide "Revise" on old versions).
  supersededBy: { select: { id: true } },
  lockedAt: true,
  isLate: true,
  submittedAt: true,
  signedName: true,
  signedAt: true,
  // How it was signed (Q6). A reviewer looking at a return should be able to see at a glance
  // whether it carries a certificate signature or only the typed name, without going and asking.
  signatureFormat: true,
  // The account whose e-signature filed the return, so reviewers see who submitted it.
  signedBy: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
  validationWarnings: true,
  createdAt: true,
  updatedAt: true,
  entity: { select: { id: true, name: true, type: true } },
  period: {
    select: {
      id: true,
      label: true,
      frequency: true,
      dueDate: true,
      graceDays: true,
      status: true,
    },
  },
  // The full template structure travels with the submission so operators (who
  // cannot read /templates directly) can render the form from their own return.
  template: {
    select: {
      id: true,
      name: true,
      version: true,
      sections: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          key: true,
          title: true,
          description: true,
          order: true,
          applicableEntityTypes: true,
          frequency: true,
          requiredServiceCode: true,
          fields: {
            orderBy: { order: 'asc' },
            select: {
              id: true,
              key: true,
              label: true,
              description: true,
              order: true,
              dataType: true,
              unit: true,
              decimals: true,
              isMandatory: true,
              flowOrStock: true,
              minValue: true,
              maxValue: true,
              referenceCategory: true,
              allowsOther: true,
              frequencyOverride: true,
              isLevyBasis: true,
            },
          },
        },
      },
    },
  },
  values: {
    select: {
      id: true,
      fieldId: true,
      valueText: true,
      isUnavailable: true,
      unavailableReason: true,
      otherText: true,
    },
  },
  attachments: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      submissionId: true,
      kind: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      uploadedById: true,
      createdAt: true,
    },
  },
} satisfies Prisma.SubmissionSelect;

export const SUBMISSION_SORT_COLUMNS = [
  'createdAt',
  'submittedAt',
  'status',
  'referenceNumber',
] as const;
export type SubmissionSortColumn = (typeof SUBMISSION_SORT_COLUMNS)[number];
