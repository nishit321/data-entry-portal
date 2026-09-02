// Shared domain types, kept in sync with the backend contracts.

/**
 * The canonical semantic tone vocabulary (FRONTEND_STANDARDS §3.3). Primitives
 * (`Badge`, `Alert`, `StatCard`) take a `tone` from this set — never a raw colour —
 * and the status→tone maps in `lib/status.ts` are the single source of the mapping.
 */
export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'gray';

export const ROLES = [
  'ADMIN',
  'SUPERVISOR',
  'ANALYST',
  'CHECKER',
  'VERIFIER',
  'APPROVER',
  'OPERATOR_ADMIN',
  'OPERATOR_SUBMITTER',
  'CITIZEN',
] as const;

export type Role = (typeof ROLES)[number];

/** Roles that belong to a regulated entity — must be linked to one (mirrors the backend rule). */
export const OPERATOR_ROLES = ['OPERATOR_ADMIN', 'OPERATOR_SUBMITTER'] as const satisfies Role[];

export function isOperatorRole(role: Role): boolean {
  return (OPERATOR_ROLES as readonly Role[]).includes(role);
}

/** Human-readable labels for roles, used across the UI. */
export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'System Administrator',
  SUPERVISOR: 'Authority Supervisor / DG',
  ANALYST: 'Authority Analyst (M&E)',
  CHECKER: 'Checker',
  VERIFIER: 'Verifier',
  APPROVER: 'Approver',
  OPERATOR_ADMIN: 'Operator Administrator',
  OPERATOR_SUBMITTER: 'Operator Submitter',
  CITIZEN: 'Citizen',
};

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  isActive: boolean;
  entityId?: string | null;
  /** E.164, and only ever present once confirmed. An unproved number is not a contact detail. */
  phone?: string | null;
  phoneVerifiedAt?: string | null;
  /** Owning entity, included so the admin listing can show the operator name. */
  entity?: { name: string } | null;
  lastLoginAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
}

/** Login returns this instead of a token when MFA is on (token issued after OTP). */
export interface MfaChallenge {
  mfaRequired: true;
  challengeId: string;
  expiresInSec: number;
  /** Only outside production: the static demo OTP, shown as a hint. */
  devOtp?: string;
}

export type LoginResult = AuthResponse | MfaChallenge;

export function isMfaChallenge(r: LoginResult): r is MfaChallenge {
  return 'mfaRequired' in r && r.mfaRequired;
}

export interface CreateUserResponse {
  user: User;
  temporaryPassword?: string;
}

// --- Pagination (mirrors the backend { data, meta } envelope) ---

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

// --- Entities ---

export const ENTITY_TYPES = ['MNO', 'ISP', 'MMO', 'VENDOR', 'OTHER'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  MNO: 'Mobile Network Operator',
  ISP: 'Internet Service Provider',
  MMO: 'Mobile Money Operator',
  VENDOR: 'Vendor',
  OTHER: 'Other',
};

export const ENTITY_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'DEREGISTERED'] as const;
export type EntityStatus = (typeof ENTITY_STATUSES)[number];

export const ENTITY_STATUS_LABELS: Record<EntityStatus, string> = {
  PENDING: 'Pending',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  DEREGISTERED: 'Deregistered',
};

/** Full entity record (detail / create / update responses). */
export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  status: EntityStatus;
  licenceNumber: string;
  licenceIssuedAt?: string | null;
  yearsInOperation?: number | null;
  geographicScope?: string | null;
  headquartersAddress?: string | null;
  primaryContactName?: string | null;
  primaryContactTitle?: string | null;
  primaryContactEmail?: string | null;
  primaryContactPhone?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Lighter row returned in the paginated list, with a live agent count. */
export interface EntityListRow {
  id: string;
  name: string;
  type: EntityType;
  status: EntityStatus;
  licenceNumber: string;
  licenceIssuedAt?: string | null;
  createdAt: string;
  _count: { agents: number };
}

// --- Reference data ---

export const REFERENCE_CATEGORIES = [
  'SPECTRUM_BAND',
  'TECHNOLOGY',
  'SERVICE_TYPE',
  'GEO_CLASSIFICATION',
  'ENERGY_GENERATION_TYPE',
  'ENERGY_STORAGE_TYPE',
  'FIXED_ACCESS_TYPE',
  'TRANSACTION_TYPE',
] as const;

export type ReferenceCategory = (typeof REFERENCE_CATEGORIES)[number];

export const REFERENCE_CATEGORY_LABELS: Record<ReferenceCategory, string> = {
  SPECTRUM_BAND: 'Spectrum bands',
  TECHNOLOGY: 'Technologies',
  SERVICE_TYPE: 'Service types',
  GEO_CLASSIFICATION: 'Geographic classifications',
  ENERGY_GENERATION_TYPE: 'Energy generation types',
  ENERGY_STORAGE_TYPE: 'Energy storage types',
  FIXED_ACCESS_TYPE: 'Fixed access types',
  TRANSACTION_TYPE: 'Transaction types',
};

export interface ReferenceItem {
  id: string;
  category: ReferenceCategory;
  code: string;
  label: string;
  description?: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// --- Templates (questionnaire definitions) ---

export const TEMPLATE_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

export const REPORTING_FREQUENCIES = [
  'MONTHLY',
  'QUARTERLY',
  'ANNUAL',
  'QUARTERLY_AND_ANNUAL',
] as const;
export type ReportingFrequency = (typeof REPORTING_FREQUENCIES)[number];
export const REPORTING_FREQUENCY_LABELS: Record<ReportingFrequency, string> = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  ANNUAL: 'Annual',
  QUARTERLY_AND_ANNUAL: 'Quarterly & Annual',
};

export const FIELD_TYPES = [
  'INTEGER',
  'DECIMAL',
  'PERCENTAGE',
  'MONETARY',
  'BOOLEAN',
  'DATE',
  'TEXT',
  'TEXTAREA',
  'REFERENCE',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  INTEGER: 'Integer (count)',
  DECIMAL: 'Decimal',
  PERCENTAGE: 'Percentage',
  MONETARY: 'Monetary (SSP)',
  BOOLEAN: 'Yes / No',
  DATE: 'Date',
  TEXT: 'Text',
  TEXTAREA: 'Long text',
  REFERENCE: 'Reference (dropdown)',
};

export const FLOW_OR_STOCK = ['NONE', 'STOCK', 'FLOW_DERIVED', 'FLOW_ENTERED'] as const;
export type FlowOrStock = (typeof FLOW_OR_STOCK)[number];
export const FLOW_OR_STOCK_LABELS: Record<FlowOrStock, string> = {
  NONE: 'Not rolled up',
  STOCK: 'Stock (year-end)',
  FLOW_DERIVED: 'Flow (derived from quarters)',
  FLOW_ENTERED: 'Flow (entered as audited annual)',
};

export interface TemplateField {
  id: string;
  sectionId: string;
  key: string;
  label: string;
  description?: string | null;
  order: number;
  dataType: FieldType;
  unit?: string | null;
  decimals?: number | null;
  isMandatory: boolean;
  flowOrStock: FlowOrStock;
  minValue?: string | null;
  maxValue?: string | null;
  referenceCategory?: ReferenceCategory | null;
  allowsOther: boolean;
  frequencyOverride?: ReportingFrequency | null;
  /** Marks the monetary field whose value is the assessable revenue for the regulatory levy. */
  isLevyBasis?: boolean;
}

export interface TemplateSection {
  id: string;
  templateId: string;
  key: string;
  title: string;
  description?: string | null;
  order: number;
  applicableEntityTypes: EntityType[];
  frequency: ReportingFrequency;
  requiredServiceCode?: string | null;
  fields: TemplateField[];
}

// Configurable cross-field / period-on-period validation rules (VALIDATION_SPEC §6).
export const RULE_TYPES = [
  'SUM_EQUALS_TOTAL',
  'LESS_OR_EQUAL',
  'FLOAT_RECONCILE',
  'PERIOD_ON_PERIOD',
  'NONZERO_REQUIRES',
] as const;
export type RuleType = (typeof RULE_TYPES)[number];
export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  SUM_EQUALS_TOTAL: 'Parts must sum to total',
  LESS_OR_EQUAL: 'One value must not exceed another',
  FLOAT_RECONCILE: 'Balance must back the liability',
  PERIOD_ON_PERIOD: 'Flag a large change from the previous period',
  NONZERO_REQUIRES: 'A non-zero value requires another',
};
/** The operand/threshold keys each rule type expects in its `config` (for the editor). */
export const RULE_TYPE_CONFIG_KEYS: Record<RuleType, string[]> = {
  SUM_EQUALS_TOTAL: ['operands', 'total', 'tolerancePercent'],
  LESS_OR_EQUAL: ['left', 'right'],
  FLOAT_RECONCILE: ['balance', 'backing', 'shortfallPercent', 'surplusPercent'],
  PERIOD_ON_PERIOD: ['field', 'thresholdPercent'],
  NONZERO_REQUIRES: ['when', 'require'],
};

export const RULE_SEVERITIES = ['HARD', 'SOFT'] as const;
export type RuleSeverity = (typeof RULE_SEVERITIES)[number];
export const RULE_SEVERITY_LABELS: Record<RuleSeverity, string> = {
  HARD: 'Hard (blocks submission)',
  SOFT: 'Soft (warns only)',
};

export interface TemplateRule {
  id: string;
  templateId: string;
  type: RuleType;
  severity: RuleSeverity;
  label: string;
  config: Record<string, unknown>;
  order: number;
  createdAt: string;
  updatedAt: string;
}

/** Full template with ordered sections + fields + rules (detail response). */
export interface ReportingTemplate {
  id: string;
  name: string;
  description?: string | null;
  version: number;
  status: TemplateStatus;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  sections: TemplateSection[];
  rules: TemplateRule[];
}

/** Light row for the templates list. */
export interface TemplateListRow {
  id: string;
  name: string;
  version: number;
  status: TemplateStatus;
  publishedAt?: string | null;
  updatedAt: string;
  _count: { sections: number };
}

// --- Submissions ---

export const SUBMISSION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];
export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

// --- Review workflow (Checker → Verifier → Approver) ---
export const REVIEW_STAGES = ['CHECKER', 'VERIFIER', 'APPROVER'] as const;
export type ReviewStage = (typeof REVIEW_STAGES)[number];
export const REVIEW_STAGE_LABELS: Record<ReviewStage, string> = {
  CHECKER: 'Checker',
  VERIFIER: 'Verifier',
  APPROVER: 'Approver',
};
export type ReviewDecision = 'APPROVE' | 'REJECT';

/** One decision in a return's review history (Authority-only view). */
export interface ReviewStep {
  id: string;
  stage: ReviewStage;
  decision: ReviewDecision;
  comment?: string | null;
  createdAt: string;
  actor?: { id: string; firstName: string; lastName: string; email: string; role: Role } | null;
}

export interface ReviewHistory {
  id: string;
  status: SubmissionStatus;
  reviewStage?: ReviewStage | null;
  steps: ReviewStep[];
}

export interface SubmissionValue {
  id: string;
  fieldId: string;
  valueText?: string | null;
  isUnavailable: boolean;
  unavailableReason?: string | null;
  otherText?: string | null;
}

/** The kind of supporting file attached to a return. */
export type AttachmentKind = 'COVERAGE_MAP' | 'FIBRE_MAP' | 'AGENT_REGISTER' | 'OTHER';

export const ATTACHMENT_KINDS: AttachmentKind[] = [
  'COVERAGE_MAP',
  'FIBRE_MAP',
  'AGENT_REGISTER',
  'OTHER',
];

export const ATTACHMENT_KIND_LABELS: Record<AttachmentKind, string> = {
  COVERAGE_MAP: 'Coverage map',
  FIBRE_MAP: 'Fibre network map',
  AGENT_REGISTER: 'Agent register',
  OTHER: 'Other document',
};

/** Accepted file formats per kind, shown to the operator and used on the file picker. */
export const ATTACHMENT_KIND_FORMATS: Record<AttachmentKind, string> = {
  COVERAGE_MAP: '.kml, .kmz',
  FIBRE_MAP: '.kml, .kmz, .json, .geojson',
  AGENT_REGISTER: '.csv, .xlsx',
  OTHER: '.pdf, .csv, .xlsx, .json, .png, .jpg',
};

/** The event a notification is about (mirrors the backend NotificationType). */
export type NotificationType =
  | 'RETURN_AWAITING_REVIEW'
  | 'RETURN_APPROVED'
  | 'RETURN_REJECTED'
  | 'ENFORCEMENT_CASE_OPENED'
  | 'ENFORCEMENT_CASE_CLOSED'
  | 'DOCUMENT_EXPIRING'
  | 'DOCUMENT_EXPIRED'
  | 'COMPLAINT_RECEIVED';

/** A single in-app notification for the signed-in user. */
export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  linkPath?: string | null;
  submissionId?: string | null;
  readAt?: string | null;
  createdAt: string;
}

/** A supporting file attached to a return (metadata only — the blob is fetched on download). */
export interface SubmissionAttachment {
  id: string;
  submissionId: string;
  kind: AttachmentKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedById: string;
  createdAt: string;
}

/**
 * A single validation issue — a soft warning stored at submit time, or either
 * tier returned by the dry-run validate endpoint. `code` is the rule type (or
 * a field-level check code); `fieldKey` points at the offending field.
 */
export interface SubmissionWarning {
  sectionKey: string;
  fieldKey: string;
  label: string;
  code: string;
  message: string;
}

/** Dry-run validation result (POST /submissions/:id/validate): both tiers. */
export interface ValidationResult {
  hard: SubmissionWarning[];
  soft: SubmissionWarning[];
}

/** A row of an uploaded workbook that could not be used, with a reason for the operator. */
export interface RejectedWorkbookRow {
  rowNumber: number;
  key: string;
  reason: string;
}

/** What loading a filled workbook did: what went in, what did not, and what the engine says. */
export interface WorkbookUploadReport {
  applied: number;
  rejected: RejectedWorkbookRow[];
  validation: ValidationResult;
}

/** Full submission with its answered values + the template structure to render. */
export interface Submission {
  id: string;
  referenceNumber?: string | null;
  entityId: string;
  periodId: string;
  templateId: string;
  status: SubmissionStatus;
  reviewStage?: ReviewStage | null;
  rejectionReason?: string | null;
  version?: number;
  supersedesId?: string | null;
  /** Present when a newer version has replaced this one (so it's read-only history). */
  supersededBy?: { id: string } | null;
  lockedAt?: string | null;
  isLate: boolean;
  submittedAt?: string | null;
  signedName?: string | null;
  signedAt?: string | null;
  /** The account whose e-signature filed the return (for the Authority's audit view). */
  signedBy?: { id: string; firstName: string; lastName: string; email: string; role: Role } | null;
  validationWarnings?: SubmissionWarning[] | null;
  createdAt: string;
  updatedAt: string;
  entity: { id: string; name: string; type: EntityType };
  period: {
    id: string;
    label: string;
    frequency: ReportingFrequency;
    dueDate: string;
    graceDays: number;
    status: PeriodStatus;
  };
  template: { id: string; name: string; version: number; sections: TemplateSection[] };
  values: SubmissionValue[];
  attachments?: SubmissionAttachment[];
}

// --- Enforcement / compliance (Q3) ---

export const ENFORCEMENT_STATUSES = ['OPEN', 'RESOLVED', 'WAIVED'] as const;
export type EnforcementStatus = (typeof ENFORCEMENT_STATUSES)[number];
export const ENFORCEMENT_STATUS_LABELS: Record<EnforcementStatus, string> = {
  OPEN: 'Open',
  RESOLVED: 'Resolved',
  WAIVED: 'Waived',
};

export const ENFORCEMENT_REASONS = ['MISSED_DEADLINE'] as const;
export type EnforcementReason = (typeof ENFORCEMENT_REASONS)[number];
export const ENFORCEMENT_REASON_LABELS: Record<EnforcementReason, string> = {
  MISSED_DEADLINE: 'Missed deadline',
};

/** A compliance case against an entity for a reporting period. */
export interface EnforcementCase {
  id: string;
  reason: EnforcementReason;
  status: EnforcementStatus;
  note?: string | null;
  openedAt: string;
  resolvedAt?: string | null;
  resolutionNote?: string | null;
  createdAt: string;
  entity: { id: string; name: string; type: EntityType };
  period: { id: string; label: string; frequency: ReportingFrequency; dueDate: string };
  /** Name only: an operator sees who closed their case, not that officer's contact details. */
  resolvedBy?: { id: string; firstName: string; lastName: string } | null;

  // --- Penalty assessment (Phase 2). Null until NCA has entered a schedule. ---
  /** Assessed so far, in SSP. Frozen once the case is closed. */
  penaltyAmount?: string | number | null;
  /** Days of continued default the amount rests on. */
  penaltyDays?: number;
  penaltyAssessedAt?: string | null;
  /** When the grace window closed and the contravention began. */
  defaultStartedAt?: string | null;
  /** When the missing return finally arrived. */
  defaultEndedAt?: string | null;
  /** The schedule line the amount was priced under, so it can be explained. */
  penaltyRule?: {
    id: string;
    label: string | null;
    fixedAmount: string | number;
    dailyAmount: string | number;
    maxAmount: string | number | null;
  } | null;
}

/** One line of NCA Legal's penalty schedule (Q3). Amounts are configuration, not code. */
export interface PenaltyRule {
  id: string;
  reason: EnforcementReason;
  /** Applies to one class of operator, or to every class when null. */
  entityType: EntityType | null;
  fixedAmount: string | number;
  dailyAmount: string | number;
  maxAmount: string | number | null;
  label: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
}

// --- Analytics (Q14) ---

/** Headline compliance figures for the dashboard, computed in aggregate on the server. */
export interface AnalyticsSummary {
  submissions: {
    total: number;
    draft: number;
    submitted: number;
    underReview: number;
    approved: number;
    rejected: number;
  };
  timeliness: { onTime: number; late: number };
  pipeline: { checker: number; verifier: number; approver: number };
  compliance: { open: number; resolved: number; waived: number };
  /** Share of decided returns that were approved (0–1), or null when nothing is decided. */
  approvalRate: number | null;
}

/** One point in the compliance trend series (a reporting period). */
export interface AnalyticsTrendPoint {
  periodId: string;
  label: string;
  dueDate: string;
  filed: number;
  onTime: number;
  late: number;
  approved: number;
  rejected: number;
}

export interface AnalyticsTrends {
  periods: AnalyticsTrendPoint[];
}

// --- Trend anomalies (Phase 2) ---

export type AnomalyKind =
  'SPIKE' | 'DROP' | 'NEW_ZERO' | 'FIRST_REPORT' | 'DRIFT' | 'SEASONAL_BREAK';
export type AnomalySeverity = 'HIGH' | 'MEDIUM';

export const ANOMALY_KIND_LABELS: Record<AnomalyKind, string> = {
  SPIKE: 'Jumped',
  DROP: 'Fell',
  NEW_ZERO: 'Now zero',
  FIRST_REPORT: 'First report',
  DRIFT: 'Drifting',
  SEASONAL_BREAK: 'Off its pattern',
};

/** How the statistical layer (Phase 3) describes what it found. */
export type StatisticalKind = 'OUTLIER' | 'SEASONAL_BREAK' | 'DRIFT';

export interface StatisticalFinding {
  kind: StatisticalKind;
  /** How unusual, where 1 sits exactly at the threshold. Comparable across questions. */
  score: number;
  severity: AnomalySeverity;
  value: number;
  /** What the figure was judged against. */
  expected: number;
  /** How much this question normally moves, in its own units. */
  typicalSwing: number;
  historySize: number;
  explanation: string;
}

export interface Anomaly {
  kind: AnomalyKind;
  severity: AnomalySeverity;
  value: number;
  baseline: number | null;
  baselineSize: number;
  changePercent: number | null;
  explanation: string;
}

export interface AnomalyRow {
  entity: { id: string; name: string };
  period: { id: string; label: string; dueDate: string };
  field: { key: string; label: string; unit: string | null };
  template: { name: string };
  submissionId: string;
  status: SubmissionStatus;
  anomaly: Anomaly;
  /** Present when there was enough history for the statistical layer to have a view. */
  statistical?: StatisticalFinding | null;
}

export interface AnomalyReport {
  total: number;
  high: number;
  thresholdPercent: number;
  rows: AnomalyRow[];
}

// --- Machine-to-machine API (Q10, Phase 3) ---

export const API_SCOPES = [
  'READ_PERIODS',
  'READ_RETURNS',
  'SUBMIT_RETURNS',
  'FEED_INGEST',
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const API_SCOPE_LABELS: Record<ApiScope, string> = {
  READ_PERIODS: 'See what is due',
  READ_RETURNS: 'Read its own returns',
  SUBMIT_RETURNS: 'File returns',
  FEED_INGEST: 'Send a metric feed',
};

export const API_SCOPE_HINTS: Record<ApiScope, string> = {
  READ_PERIODS: 'Which returns are open and when they are due.',
  READ_RETURNS: 'The returns this operator has already filed.',
  SUBMIT_RETURNS: 'Open a draft, fill it in and file it. The strongest of these.',
  FEED_INGEST: 'Accept a scheduled feed of network metrics.',
};

export const API_CLIENT_STATUSES = ['ACTIVE', 'SUSPENDED', 'REVOKED'] as const;
export type ApiClientStatus = (typeof API_CLIENT_STATUSES)[number];

export const API_CLIENT_STATUS_LABELS: Record<ApiClientStatus, string> = {
  ACTIVE: 'In use',
  SUSPENDED: 'Paused',
  REVOKED: 'Revoked',
};

export interface ApiClient {
  id: string;
  name: string;
  /** The public half. Safe to show and to log. */
  clientId: string;
  /** Last four characters of the secret, to tell two credentials apart. */
  secretLast4: string;
  certFingerprint: string | null;
  allowedCidrs: string[];
  scopes: ApiScope[];
  rateLimitPerMinute: number;
  status: ApiClientStatus;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  serviceUserId: string;
  createdAt: string;
  entity: { id: string; name: string; type: EntityType };
}

/** Issue and rotate return the secret. It is never available again. */
export interface ApiClientWithSecret extends ApiClient {
  clientSecret: string;
}

// --- Data-sharing agreements and network feeds (Q10, Phase 3) ---

export const AGREEMENT_STATUSES = ['DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED'] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];

export const AGREEMENT_STATUS_LABELS: Record<AgreementStatus, string> = {
  DRAFT: 'Being negotiated',
  ACTIVE: 'In force',
  EXPIRED: 'Ran out',
  TERMINATED: 'Ended',
};

export const FEED_FREQUENCIES = ['HOURLY', 'DAILY', 'WEEKLY'] as const;
export type FeedFrequency = (typeof FEED_FREQUENCIES)[number];

export const FEED_FREQUENCY_LABELS: Record<FeedFrequency, string> = {
  HOURLY: 'Every hour',
  DAILY: 'Every day',
  WEEKLY: 'Every week',
};

export const FEED_RUN_OUTCOMES = ['SUCCEEDED', 'FAILED', 'SKIPPED'] as const;
export type FeedRunOutcome = (typeof FEED_RUN_OUTCOMES)[number];

export const FEED_RUN_OUTCOME_LABELS: Record<FeedRunOutcome, string> = {
  SUCCEEDED: 'Collected',
  FAILED: 'Failed',
  SKIPPED: 'Not collected',
};

export interface DataSharingAgreement {
  id: string;
  reference: string;
  title: string;
  scope: string | null;
  status: AgreementStatus;
  signedAt: string | null;
  startsAt: string;
  endsAt: string | null;
  createdAt: string;
  entity: { id: string; name: string; type: EntityType };
  _count: { feeds: number };
}

/** The access token an operator issued to NCA is never returned by any read. */
export interface NetworkFeed {
  id: string;
  name: string;
  url: string;
  frequency: FeedFrequency;
  hour: number;
  dayOfWeek: number;
  isEnabled: boolean;
  lastRunAt: string | null;
  lastOutcome: FeedRunOutcome | null;
  lastError: string | null;
  createdAt: string;
  agreement: {
    id: string;
    reference: string;
    title: string;
    status: AgreementStatus;
    startsAt: string;
    endsAt: string | null;
    entity: { id: string; name: string };
  };
}

/**
 * One measurement that arrived on a feed.
 *
 * Deliberately not a submission value. This is telemetry an operator agreed to share, not a figure
 * it filed and signed, and nothing here enters the review workflow.
 */
export interface FeedMetric {
  id: string;
  key: string;
  /** Decimal columns arrive as strings; parse before doing arithmetic. */
  value: string | number;
  unit: string | null;
  measuredAt: string;
  entity: { id: string; name: string };
  feedRun: { id: string; feed: { id: string; name: string } };
}

export interface FeedRun {
  id: string;
  outcome: FeedRunOutcome;
  startedAt: string;
  finishedAt: string | null;
  metricCount: number;
  httpStatus: number | null;
  message: string | null;
}

// --- Signing certificates (Q6, Phase 3) ---

export const SIGNATURE_FORMATS = ['SIMPLE', 'PKI'] as const;
export type SignatureFormat = (typeof SIGNATURE_FORMATS)[number];

export const SIGNATURE_FORMAT_LABELS: Record<SignatureFormat, string> = {
  SIMPLE: 'Signed by name',
  PKI: 'Signed with a certificate',
};

export interface SigningCertificate {
  id: string;
  label: string;
  fingerprint: string;
  subject: string;
  issuer: string;
  algorithm: string;
  notBefore: string;
  notAfter: string;
  selfSigned: boolean;
  status: 'ACTIVE' | 'REVOKED';
  createdAt: string;
}

/**
 * The result of checking a return's signature now.
 *
 * `verified` is null when there is nothing to check — an unsigned return, or one carrying only the
 * typed-name signature. False means it was checked and did not match, which is a different and far
 * more serious answer.
 */
export interface SignatureVerification {
  submissionId: string;
  format: SignatureFormat;
  signed: boolean;
  verified: boolean | null;
  message: string;
}

// --- Network geography (Phase 2) ---

export const NETWORK_SITE_KINDS = [
  'BASE_STATION',
  'FIBRE_NODE',
  'POP',
  'DATA_CENTRE',
  'OTHER',
] as const;
export type NetworkSiteKind = (typeof NETWORK_SITE_KINDS)[number];

export const NETWORK_SITE_KIND_LABELS: Record<NetworkSiteKind, string> = {
  BASE_STATION: 'Base station',
  FIBRE_NODE: 'Fibre node',
  POP: 'Point of presence',
  DATA_CENTRE: 'Data centre',
  OTHER: 'Other site',
};

export const NETWORK_SITE_STATUSES = ['PLANNED', 'ACTIVE', 'DECOMMISSIONED'] as const;
export type NetworkSiteStatus = (typeof NETWORK_SITE_STATUSES)[number];

export const NETWORK_SITE_STATUS_LABELS: Record<NetworkSiteStatus, string> = {
  PLANNED: 'Planned',
  ACTIVE: 'In service',
  DECOMMISSIONED: 'Retired',
};

export interface NetworkSite {
  id: string;
  siteReference: string;
  name: string;
  kind: NetworkSiteKind;
  status: NetworkSiteStatus;
  /** Decimal columns arrive as strings; parse before doing arithmetic with them. */
  latitude: string | number;
  longitude: string | number;
  location: string | null;
  technology: string | null;
  /** Approximate coverage radius in metres, where the operator reports one. */
  coverageM: number | null;
  commissionedAt: string | null;
  createdAt: string;
  entity: { id: string; name: string; type: EntityType };
}

/** A point as the map draws it. Coordinates are already numbers. */
export interface MapPoint {
  id: string;
  kind: NetworkSiteKind | 'AGENT';
  name: string;
  lat: number;
  lng: number;
  entity: { id: string; name: string };
  status?: NetworkSiteStatus;
  coverageM?: number | null;
}

export interface MapReport {
  points: MapPoint[];
  /** True when the cap bit and the map is showing only part of the picture. */
  truncated: boolean;
  counts: { sites: number; agents: number };
}

// --- Scheduled sector reports (Phase 2) ---

export const SCHEDULED_REPORT_KINDS = [
  'COMPLIANCE_WORKBOOK',
  'LEVY_WORKBOOK',
  'LEVY_STATEMENT',
] as const;
export type ScheduledReportKind = (typeof SCHEDULED_REPORT_KINDS)[number];

export const SCHEDULED_REPORT_KIND_LABELS: Record<ScheduledReportKind, string> = {
  COMPLIANCE_WORKBOOK: 'Sector compliance (Excel)',
  LEVY_WORKBOOK: 'Levy assessment (Excel)',
  LEVY_STATEMENT: 'Levy statement (PDF)',
};

export const REPORT_FREQUENCIES = ['WEEKLY', 'MONTHLY', 'QUARTERLY'] as const;
export type ReportFrequency = (typeof REPORT_FREQUENCIES)[number];

export const REPORT_FREQUENCY_LABELS: Record<ReportFrequency, string> = {
  WEEKLY: 'Every week',
  MONTHLY: 'Every month',
  QUARTERLY: 'Every quarter',
};

/** Weekday names for a weekly schedule; the API stores Monday as 1. */
export const WEEKDAY_LABELS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export interface ReportScheduleRecipient {
  user: { id: string; firstName: string; lastName: string; email: string; role: Role };
}

export interface ReportSchedule {
  id: string;
  name: string;
  kind: ScheduledReportKind;
  frequency: ReportFrequency;
  dayOfPeriod: number;
  hour: number;
  isEnabled: boolean;
  lastRunAt: string | null;
  /** Why the last attempt failed, if it did. Cleared once one goes out. */
  lastError: string | null;
  createdAt: string;
  recipients: ReportScheduleRecipient[];
}

// --- Public portal / open data (Q4, Phase 2) ---

export const PUBLIC_AGGREGATIONS = ['SUM', 'AVERAGE', 'COUNT'] as const;
export type PublicAggregation = (typeof PUBLIC_AGGREGATIONS)[number];

export const PUBLIC_AGGREGATION_LABELS: Record<PublicAggregation, string> = {
  SUM: 'Added up across operators',
  AVERAGE: 'Averaged across operators',
  COUNT: 'How many operators reported',
};

/** One line of the allowlist that decides what leaves the building. */
export interface PublicIndicator {
  id: string;
  fieldKey: string;
  aggregation: PublicAggregation;
  label: string;
  unit: string | null;
  description: string | null;
  order: number;
  isPublished: boolean;
  createdAt: string;
}

/**
 * One period's published figure. `withheld` means too few operators reported for the figure to be
 * published without identifying one of them, so `value` is null.
 */
export interface PublicPoint {
  periodId: string;
  label: string;
  dueDate: string;
  value: number | null;
  contributors: number;
  withheld: boolean;
}

export interface PublicIndicatorSeries {
  id: string;
  label: string;
  unit: string | null;
  description: string | null;
  aggregation: PublicAggregation;
  points: PublicPoint[];
}

export interface PublicIndicatorReport {
  threshold: number;
  periods: { id: string; label: string; dueDate: string }[];
  indicators: PublicIndicatorSeries[];
}

export interface PublicComplaintsSummary {
  total: number;
  byStatus: { received: number; inReview: number; resolved: number; closed: number };
  byCategory: { category: ComplaintCategory; count: number }[];
  resolution: { resolved: number; medianDays: number | null };
}

// --- Benchmarking (Phase 2) ---

/**
 * An operator's standing among its peers. `withheld` means the peer group was too small to say
 * anything without pointing at a named competitor, so every aggregate below it is null.
 */
export interface PeerSummary {
  groupSize: number;
  value: number | null;
  rank: number | null;
  shareOfTotal: number | null;
  median: number | null;
  mean: number | null;
  withheld: boolean;
}

export interface BenchmarkPeerGroup {
  entityType: EntityType | null;
  size: number;
}

/** Named per-entity rows arrive only for Authority readers; operators get an empty list. */
export interface ComplianceBenchmarkRow {
  entity: { id: string; name: string; type: EntityType };
  filed: number;
  onTime: number;
  late: number;
  approved: number;
  rejected: number;
  onTimeRate: number | null;
  approvalRate: number | null;
}

export interface ComplianceBenchmark {
  peerGroup: BenchmarkPeerGroup;
  subjectId: string | null;
  metrics: {
    filings: PeerSummary;
    onTimeRate: PeerSummary;
    approvalRate: PeerSummary;
  };
  rows: ComplianceBenchmarkRow[];
}

export interface BenchmarkIndicator {
  fieldKey: string;
  label: string;
  unit: string | null;
  isLevyBasis: boolean;
  section: string;
  template: { id: string; name: string };
}

export interface IndicatorCatalogue {
  indicators: BenchmarkIndicator[];
}

export interface IndicatorBenchmark {
  peerGroup: BenchmarkPeerGroup;
  subjectId: string | null;
  period: { id: string; label: string; dueDate: string } | null;
  field: { key: string; label: string; unit: string | null } | null;
  summary: PeerSummary;
  rows: { entity: { id: string; name: string; type: EntityType }; value: number | null }[];
  reporting: number;
}

// --- Complaints (citizen intake, Q4) ---

export const COMPLAINT_CATEGORIES = [
  'SERVICE_QUALITY',
  'BILLING',
  'COVERAGE',
  'AGENT_CONDUCT',
  'DATA_PRIVACY',
  'SUGGESTION',
  'OTHER',
] as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];
export const COMPLAINT_CATEGORY_LABELS: Record<ComplaintCategory, string> = {
  SERVICE_QUALITY: 'Service quality',
  BILLING: 'Billing',
  COVERAGE: 'Network coverage',
  AGENT_CONDUCT: 'Agent conduct',
  DATA_PRIVACY: 'Data and privacy',
  SUGGESTION: 'Suggestion',
  OTHER: 'Something else',
};

export const COMPLAINT_STATUSES = ['RECEIVED', 'IN_REVIEW', 'RESOLVED', 'CLOSED'] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];
export const COMPLAINT_STATUS_LABELS: Record<ComplaintStatus, string> = {
  RECEIVED: 'Received',
  IN_REVIEW: 'In review',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

/** The Authority's view of a case: the full file, including who filed it. */
export interface Complaint {
  id: string;
  referenceNumber: string;
  category: ComplaintCategory;
  status: ComplaintStatus;
  subject: string;
  description: string;
  complainantName?: string | null;
  complainantEmail?: string | null;
  complainantPhone?: string | null;
  resolutionNote?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  aboutEntity?: { id: string; name: string; type: EntityType } | null;
  handledBy?: { id: string; firstName: string; lastName: string; email: string } | null;
}

/** What a citizen sees when tracking their own complaint. Deliberately narrow. */
export interface ComplaintTracking {
  referenceNumber: string;
  category: ComplaintCategory;
  status: ComplaintStatus;
  subject: string;
  resolutionNote?: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
}

// --- Documents (licence repository) ---

export const DOCUMENT_KINDS = ['LICENCE', 'CERTIFICATE', 'OTHER'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  LICENCE: 'Licence',
  CERTIFICATE: 'Certificate',
  OTHER: 'Other document',
};

/** How far through its life a document is. Null when it has no expiry date. */
export type DocumentExpiryStage = 'EXPIRING' | 'EXPIRED';

/** Formats the repository accepts, shown to the operator and used on the file picker. */
export const DOCUMENT_ACCEPT = '.pdf, .png, .jpg, .jpeg';

export interface DocumentRecord {
  id: string;
  entityId: string;
  kind: DocumentKind;
  title: string;
  reference?: string | null;
  issuedAt?: string | null;
  expiresAt?: string | null;
  version: number;
  supersedesId?: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  entity: { id: string; name: string; type: EntityType };
  uploadedBy?: { id: string; firstName: string; lastName: string; email: string } | null;
  /** Computed server-side so every screen shows the same signal. */
  expiry: { stage: DocumentExpiryStage | null; daysRemaining: number | null };
}

// --- Revenue levy (Q14) ---

/** A configured levy rate window. `ratePercent` is a percentage, e.g. 2.5 for 2.5%. */
export interface LevyRate {
  id: string;
  ratePercent: string | number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  label?: string | null;
  createdAt: string;
}

/** One operator's assessment for a period. `levyDue` is null when no rate covers the period. */
export interface LevyAssessmentRow {
  entity: { id: string; name: string; type: EntityType };
  assessableRevenue: number;
  levyDue: number | null;
}

export interface LevyAssessment {
  period: { id: string; label: string; dueDate: string } | null;
  template: { name: string } | null;
  /** False when the questionnaire has no field marked as the levy basis. */
  levyBasisConfigured: boolean;
  rate: { id: string; ratePercent: number; label?: string | null } | null;
  totals: { operatorsAssessed: number; totalRevenue: number; totalLevyDue: number | null };
  rows: LevyAssessmentRow[];
}

/** Light row for the submissions list. */
export interface SubmissionListRow {
  id: string;
  referenceNumber?: string | null;
  status: SubmissionStatus;
  reviewStage?: ReviewStage | null;
  isLate: boolean;
  submittedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  entity: { id: string; name: string; type: EntityType };
  period: {
    id: string;
    label: string;
    frequency: ReportingFrequency;
    dueDate: string;
    status: PeriodStatus;
  };
  template: { id: string; name: string; version: number };
  _count: { values: number };
}

// --- Reporting periods ---

export const PERIOD_STATUSES = ['SCHEDULED', 'OPEN', 'CLOSED'] as const;
export type PeriodStatus = (typeof PERIOD_STATUSES)[number];
export const PERIOD_STATUS_LABELS: Record<PeriodStatus, string> = {
  SCHEDULED: 'Scheduled',
  OPEN: 'Open',
  CLOSED: 'Closed',
};

/** Computed deadline phase of a period relative to now (server-computed). */
export type PeriodPhase = 'scheduled' | 'open' | 'grace' | 'overdue' | 'closed';
export const PERIOD_PHASE_LABELS: Record<PeriodPhase, string> = {
  scheduled: 'Scheduled',
  open: 'On time',
  grace: 'In grace period',
  overdue: 'Overdue',
  closed: 'Closed',
};

/** Period frequencies valid for a single cycle (subset of ReportingFrequency). */
export const PERIOD_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'ANNUAL'] as const;
export type PeriodFrequency = (typeof PERIOD_FREQUENCIES)[number];

export interface PeriodTimeline {
  dueDate: string;
  graceEndsAt: string;
  phase: PeriodPhase;
}

export interface ReportingPeriod {
  id: string;
  templateId: string;
  frequency: ReportingFrequency;
  label: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  graceDays: number;
  status: PeriodStatus;
  openedAt?: string | null;
  closedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  template: { id: string; name: string; version: number };
  timeline: PeriodTimeline;
}

// --- Audit log ---

/** Auditable actions, mirroring the backend AuditAction enum. */
export const AUDIT_ACTIONS = [
  'USER_SIGNUP',
  'USER_LOGIN',
  'USER_LOGIN_FAILED',
  'USER_CREATED',
  'USER_UPDATED',
  'USER_ROLE_CHANGED',
  'USER_ACTIVATED',
  'USER_DEACTIVATED',
  'USER_DELETED',
  'PASSWORD_RESET_REQUESTED',
  'PASSWORD_RESET_COMPLETED',
  'ENTITY_CREATED',
  'ENTITY_UPDATED',
  'ENTITY_STATUS_CHANGED',
  'ENTITY_DELETED',
  'AGENT_CREATED',
  'AGENT_UPDATED',
  'AGENT_STATUS_CHANGED',
  'AGENT_DELETED',
  'REFERENCE_ITEM_CREATED',
  'REFERENCE_ITEM_UPDATED',
  'REFERENCE_ITEM_DELETED',
  'USER_MFA_CHALLENGED',
  'USER_MFA_FAILED',
  'USER_LOCKED',
  'TEMPLATE_CREATED',
  'TEMPLATE_UPDATED',
  'TEMPLATE_PUBLISHED',
  'TEMPLATE_DELETED',
  'TEMPLATE_VERSIONED',
  'TEMPLATE_SECTION_SAVED',
  'TEMPLATE_SECTION_DELETED',
  'TEMPLATE_FIELD_SAVED',
  'TEMPLATE_FIELD_DELETED',
  'PERIOD_CREATED',
  'PERIOD_UPDATED',
  'PERIOD_OPENED',
  'PERIOD_CLOSED',
  'PERIOD_DELETED',
  'SUBMISSION_CREATED',
  'SUBMISSION_UPDATED',
  'SUBMISSION_SUBMITTED',
  'SUBMISSION_DELETED',
  'SUBMISSION_REVIEWED',
  'SUBMISSION_APPROVED',
  'SUBMISSION_REJECTED',
  'SUBMISSION_RESUBMITTED',
  'SUBMISSION_BULK_UPLOADED',
  'ATTACHMENT_UPLOADED',
  'ATTACHMENT_DELETED',
  'TEMPLATE_RULE_SAVED',
  'TEMPLATE_RULE_DELETED',
  'ENFORCEMENT_CASE_OPENED',
  'ENFORCEMENT_CASE_RESOLVED',
  'ENFORCEMENT_CASE_WAIVED',
  'LEVY_RATE_CREATED',
  'LEVY_RATE_UPDATED',
  'LEVY_RATE_DELETED',
  'DOCUMENT_UPLOADED',
  'DOCUMENT_REPLACED',
  'DOCUMENT_DELETED',
  'COMPLAINT_FILED',
  'COMPLAINT_STATUS_CHANGED',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Plain, sentence-case labels for each action, used across the audit view. */
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  USER_SIGNUP: 'User signed up',
  USER_LOGIN: 'User logged in',
  USER_LOGIN_FAILED: 'Login failed',
  USER_CREATED: 'User created',
  USER_UPDATED: 'User updated',
  USER_ROLE_CHANGED: 'User role changed',
  USER_ACTIVATED: 'User activated',
  USER_DEACTIVATED: 'User deactivated',
  USER_DELETED: 'User deleted',
  PASSWORD_RESET_REQUESTED: 'Password reset requested',
  PASSWORD_RESET_COMPLETED: 'Password reset completed',
  ENTITY_CREATED: 'Entity created',
  ENTITY_UPDATED: 'Entity updated',
  ENTITY_STATUS_CHANGED: 'Entity status changed',
  ENTITY_DELETED: 'Entity deleted',
  AGENT_CREATED: 'Agent created',
  AGENT_UPDATED: 'Agent updated',
  AGENT_STATUS_CHANGED: 'Agent status changed',
  AGENT_DELETED: 'Agent deleted',
  REFERENCE_ITEM_CREATED: 'Reference item created',
  REFERENCE_ITEM_UPDATED: 'Reference item updated',
  REFERENCE_ITEM_DELETED: 'Reference item deleted',
  USER_MFA_CHALLENGED: 'MFA challenged',
  USER_MFA_FAILED: 'MFA failed',
  USER_LOCKED: 'User locked',
  TEMPLATE_CREATED: 'Template created',
  TEMPLATE_UPDATED: 'Template updated',
  TEMPLATE_PUBLISHED: 'Template published',
  TEMPLATE_DELETED: 'Template deleted',
  TEMPLATE_VERSIONED: 'Template versioned',
  TEMPLATE_SECTION_SAVED: 'Template section saved',
  TEMPLATE_SECTION_DELETED: 'Template section deleted',
  TEMPLATE_FIELD_SAVED: 'Template field saved',
  TEMPLATE_FIELD_DELETED: 'Template field deleted',
  PERIOD_CREATED: 'Reporting period created',
  PERIOD_UPDATED: 'Reporting period updated',
  PERIOD_OPENED: 'Reporting period opened',
  PERIOD_CLOSED: 'Reporting period closed',
  PERIOD_DELETED: 'Reporting period deleted',
  SUBMISSION_CREATED: 'Submission created',
  SUBMISSION_UPDATED: 'Submission updated',
  SUBMISSION_SUBMITTED: 'Submission submitted',
  SUBMISSION_DELETED: 'Submission deleted',
  SUBMISSION_REVIEWED: 'Submission reviewed',
  SUBMISSION_APPROVED: 'Submission approved',
  SUBMISSION_REJECTED: 'Submission rejected',
  SUBMISSION_RESUBMITTED: 'Submission resubmitted',
  SUBMISSION_BULK_UPLOADED: 'Answers uploaded from a workbook',
  ATTACHMENT_UPLOADED: 'Supporting file added',
  ATTACHMENT_DELETED: 'Supporting file removed',
  ENFORCEMENT_CASE_OPENED: 'Compliance case opened',
  ENFORCEMENT_CASE_RESOLVED: 'Compliance case resolved',
  ENFORCEMENT_CASE_WAIVED: 'Compliance case waived',
  LEVY_RATE_CREATED: 'Levy rate added',
  LEVY_RATE_UPDATED: 'Levy rate updated',
  LEVY_RATE_DELETED: 'Levy rate removed',
  DOCUMENT_UPLOADED: 'Document filed',
  DOCUMENT_REPLACED: 'Document replaced',
  DOCUMENT_DELETED: 'Document removed',
  COMPLAINT_FILED: 'Complaint filed',
  COMPLAINT_STATUS_CHANGED: 'Complaint status changed',
  TEMPLATE_RULE_SAVED: 'Validation rule saved',
  TEMPLATE_RULE_DELETED: 'Validation rule deleted',
};

/** A single audit trail record, as returned by the read endpoint. */
export interface AuditLogRow {
  id: string;
  action: AuditAction;
  entityType?: string | null;
  entityId?: string | null;
  /** Human label for the affected record (reference number, name, email …), resolved server-side. */
  target?: string | null;
  metadata?: unknown;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
  /** The account that acted. Null for system or anonymous events. */
  actor?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: Role;
  } | null;
}

// --- Agents ---

/** Latitude/longitude arrive as strings (Prisma Decimal) over the wire. */
export interface Agent {
  id: string;
  entityId: string;
  /** Owning entity, included so Authority listings can show the operator name. */
  entity?: { name: string } | null;
  agentReference: string;
  name: string;
  location?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
