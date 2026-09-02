// The single source of the status → tone mapping (FRONTEND_STANDARDS §3.3).
// A given domain status renders with the same tone in a table badge, a detail header,
// and a dashboard tile, because every screen reads the tone from here. Never pick a
// tone at a call site.

import type {
  ComplaintStatus,
  DocumentExpiryStage,
  EnforcementStatus,
  EntityStatus,
  PeriodPhase,
  PeriodStatus,
  SubmissionStatus,
  TemplateStatus,
  Tone,
} from './types';

/** Entity lifecycle status. */
export const ENTITY_STATUS_TONE: Record<EntityStatus, Tone> = {
  ACTIVE: 'success',
  PENDING: 'warning',
  SUSPENDED: 'danger',
  DEREGISTERED: 'gray',
};

/** Questionnaire template lifecycle status. */
export const TEMPLATE_STATUS_TONE: Record<TemplateStatus, Tone> = {
  DRAFT: 'warning',
  PUBLISHED: 'success',
  ARCHIVED: 'gray',
};

/** Reporting-period lifecycle status. */
export const PERIOD_STATUS_TONE: Record<PeriodStatus, Tone> = {
  SCHEDULED: 'gray',
  OPEN: 'success',
  CLOSED: 'gray',
};

/** Reporting-period deadline phase (computed): the compliance signal. */
export const PERIOD_PHASE_TONE: Record<PeriodPhase, Tone> = {
  scheduled: 'gray',
  open: 'success',
  grace: 'warning',
  overdue: 'danger',
  closed: 'gray',
};

/** Submission lifecycle status. */
export const SUBMISSION_STATUS_TONE: Record<SubmissionStatus, Tone> = {
  DRAFT: 'gray',
  SUBMITTED: 'info',
  UNDER_REVIEW: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
};

/** Complaint lifecycle: open cases need attention, resolved is the good outcome. */
export const COMPLAINT_STATUS_TONE: Record<ComplaintStatus, Tone> = {
  RECEIVED: 'info',
  IN_REVIEW: 'warning',
  RESOLVED: 'success',
  CLOSED: 'gray',
};

/** Document expiry: approaching is a warning, past the date is a breach of the record. */
export const DOCUMENT_EXPIRY_TONE: Record<DocumentExpiryStage, Tone> = {
  EXPIRING: 'warning',
  EXPIRED: 'danger',
};

/** Enforcement case status: an open case needs attention, resolved is done, waived is closed-off. */
export const ENFORCEMENT_STATUS_TONE: Record<EnforcementStatus, Tone> = {
  OPEN: 'warning',
  RESOLVED: 'success',
  WAIVED: 'gray',
};

/**
 * Active / inactive flag shared by agents, reference items, and users. Inactive is
 * muted (`gray`), not `danger` — it's a resting state, not an error.
 */
export function activeTone(isActive: boolean): Tone {
  return isActive ? 'success' : 'gray';
}

export function activeLabel(isActive: boolean): string {
  return isActive ? 'Active' : 'Inactive';
}
