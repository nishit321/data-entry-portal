import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  DatePicker,
  DescriptionList,
  Field,
  Input,
  Modal,
  Page,
  PageHeader,
  PageLoading,
  Progress,
  SaveStatus,
  Select,
  Textarea,
  Timeline,
  useToast,
  type SelectOption,
} from '../components/ui';
import { AttachmentsSection } from '../components/AttachmentsSection';
import { WorkbookPanel } from '../components/WorkbookPanel';
import { submissionsApi, submissionKeys, type SubmissionValueInput } from '../lib/submissions.api';
import { workflowApi, workflowKeys } from '../lib/workflow.api';
import { referenceApi } from '../lib/reference.api';
import { useAutosave } from '../hooks/useAutosave';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { getErrorMessage } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { SUBMISSION_STATUS_TONE } from '../lib/status';
import { formatDate, formatDateTime, joinMeta } from '../lib/format';
import {
  declaredServices,
  humaniseService,
  isStrandedSection,
  sectionApplies,
} from '../lib/service-applicability';
import {
  FLOW_OR_STOCK_LABELS,
  isOperatorRole,
  REVIEW_STAGE_LABELS,
  ROLE_LABELS,
  SUBMISSION_STATUS_LABELS,
  type ReferenceCategory,
  type ReviewDecision,
  type ReviewStage,
  type Role,
  type Submission,
  type SubmissionStatus,
  type TemplateSection,
  type TemplateField,
} from '../lib/types';

interface FieldValueState {
  valueText: string;
  isUnavailable: boolean;
  unavailableReason: string;
  otherText: string;
}

const EMPTY_FV: FieldValueState = {
  valueText: '',
  isUnavailable: false,
  unavailableReason: '',
  otherText: '',
};

const BOOLEAN_OPTIONS: SelectOption[] = [
  { value: '', label: '—' },
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
];

// Which review stage a reviewer's role acts on. Admins review nothing; operators aren't here.
const ROLE_TO_STAGE: Partial<Record<Role, ReviewStage>> = {
  CHECKER: 'CHECKER',
  VERIFIER: 'VERIFIER',
  APPROVER: 'APPROVER',
};

/** Past this many fields, the form carries a progress reading and a section nav (§3.12). */
const LONG_FORM_FIELDS = 20;

/** Seed the local form state from a submission's stored values, keyed by field id. */
function seedValues(submission: Submission): Record<string, FieldValueState> {
  const map: Record<string, FieldValueState> = {};
  for (const v of submission.values) {
    map[v.fieldId] = {
      valueText: v.valueText ?? '',
      isUnavailable: v.isUnavailable,
      unavailableReason: v.unavailableReason ?? '',
      otherText: v.otherText ?? '',
    };
  }
  return map;
}

function fieldHint(field: TemplateField): string | undefined {
  const parts: string[] = [];
  if (field.description) parts.push(field.description);
  if (field.unit) parts.push(`Unit: ${field.unit}`);
  if (field.dataType === 'PERCENTAGE') parts.push('Enter a value from 0 to 100');
  if (field.flowOrStock !== 'NONE') parts.push(FLOW_OR_STOCK_LABELS[field.flowOrStock]);
  return parts.length > 0 ? joinMeta(...parts) : undefined;
}

const NUMERIC_TYPES = ['INTEGER', 'DECIMAL', 'MONETARY', 'PERCENTAGE'] as const;

/**
 * Why this return is read-only, stated as the actual blocking reason rather than a generic
 * list of conditions — an operator shouldn't be told "the period must be open" when the period
 * is open and the real reason is that they already submitted it.
 */
function readOnlyReason(
  status: SubmissionStatus,
  periodOpen: boolean,
  isOperator: boolean,
): string {
  if (!isOperator) return 'You are viewing this return in read-only mode.';
  if (status !== 'DRAFT') {
    if (status === 'SUBMITTED')
      return 'This return has been submitted, so it can no longer be edited.';
    return `This return is ${SUBMISSION_STATUS_LABELS[status].toLowerCase()}, so it can no longer be edited.`;
  }
  // It's still a draft and the caller owns it, so the only remaining blocker is a closed period.
  if (!periodOpen) return 'The reporting period is closed, so this draft can no longer be edited.';
  return 'This return is read-only.';
}

export function SubmissionEditorPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();

  // Authority reviewers (anyone who isn't an operator) can see the review timeline; the
  // endpoint is Authority-only, so this stays disabled for operators regardless.
  const viewerIsAuthority = !!user && !isOperatorRole(user.role);

  const detailQuery = useQuery({
    queryKey: submissionKeys.detail(id),
    queryFn: () => submissionsApi.get(id),
    enabled: id !== '',
  });

  const historyQuery = useQuery({
    queryKey: workflowKeys.history(id),
    queryFn: () => workflowApi.history(id),
    // Only once the return has actually been submitted, and only for Authority viewers.
    enabled: id !== '' && viewerIsAuthority && !!detailQuery.data?.submittedAt,
  });

  const [values, setValues] = useState<Record<string, FieldValueState>>({});
  const [signOpen, setSignOpen] = useState(false);
  const [signedName, setSignedName] = useState('');
  const [reviewComment, setReviewComment] = useState('');
  const [reviewCommentError, setReviewCommentError] = useState('');
  // A pending approve/reject awaiting confirmation (both actions are irreversible).
  const [pendingDecision, setPendingDecision] = useState<ReviewDecision | null>(null);

  // Re-seed whenever a fresh submission arrives (initial load and post-save refetch).
  useEffect(() => {
    if (detailQuery.data) setValues(seedValues(detailQuery.data));
  }, [detailQuery.data]);

  // Distinct reference lists referenced by the template, fetched once each.
  const refCategories = useMemo<ReferenceCategory[]>(() => {
    if (!detailQuery.data) return [];
    const set = new Set<ReferenceCategory>();
    for (const section of detailQuery.data.template.sections) {
      for (const f of section.fields) {
        if (f.dataType === 'REFERENCE' && f.referenceCategory) set.add(f.referenceCategory);
      }
    }
    return [...set];
  }, [detailQuery.data]);

  const referenceQueries = useQueries({
    queries: refCategories.map((category) => ({
      queryKey: ['reference-data', 'lookup', category],
      queryFn: () => referenceApi.lookup(category),
      staleTime: 5 * 60 * 1000,
    })),
  });

  const referenceOptions = useMemo(() => {
    const map: Record<string, SelectOption[]> = {};
    refCategories.forEach((category, i) => {
      const items = referenceQueries[i]?.data ?? [];
      map[category] = [
        { value: '', label: '—' },
        ...items.map((it) => ({ value: it.code, label: it.label })),
      ];
    });
    return map;
  }, [refCategories, referenceQueries]);

  /** After a deliberate action (submit, revise, a review decision) both the lists and this
   *  return should refresh. Autosave must NOT use this — see the note on its onSave. */
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: submissionKeys.lists });
    void qc.invalidateQueries({ queryKey: submissionKeys.detail(id) });
  };

  const buildValues = (): SubmissionValueInput[] =>
    Object.entries(values).map(([fieldId, v]) => ({
      fieldId,
      valueText: v.isUnavailable ? undefined : v.valueText || undefined,
      isUnavailable: v.isUnavailable || undefined,
      unavailableReason: v.isUnavailable ? v.unavailableReason || undefined : undefined,
      otherText: v.otherText || undefined,
    }));

  const submitMutation = useMutation({
    // Persist the latest edits before submitting so the server records what the operator sees.
    // We only get here after a clean check (see handleSubmit), so a failure here is unusual —
    // surface it as a toast and keep the sign dialog open so the operator can try again.
    mutationFn: async () => {
      await submissionsApi.saveValues(id, buildValues());
      return submissionsApi.submit(id, signedName.trim());
    },
    onSuccess: () => {
      invalidate();
      setSignOpen(false);
      toast.success('Return submitted.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't submit your return.")),
  });

  const validateMutation = useMutation({
    // Save the current edits first so the dry-run checks exactly what the operator sees.
    mutationFn: async () => {
      await submissionsApi.saveValues(id, buildValues());
      return submissionsApi.validate(id);
    },
    onSuccess: invalidate,
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't check this return.")),
  });

  // A reviewer's approve/reject at the current stage. Rejecting requires a comment (the server
  // enforces it too); on success the status/stage changes so the panel below stops rendering.
  const decisionMutation = useMutation({
    mutationFn: (decision: ReviewDecision) =>
      workflowApi.decide(id, decision, reviewComment.trim() || undefined),
    onSuccess: (_updated, decision) => {
      void qc.invalidateQueries({ queryKey: submissionKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: workflowKeys.all });
      void qc.invalidateQueries({ queryKey: workflowKeys.history(id) });
      setReviewComment('');
      setReviewCommentError('');
      setPendingDecision(null);
      toast.success(
        decision === 'APPROVE' ? 'Return approved.' : 'Return sent back to the operator.',
        {
          // Straight back to the queue for the next one. A reviewer working through a stack
          // shouldn't have to navigate back by hand after every decision (§3.11).
          action: { label: 'Back to the queue', onClick: () => navigate('/review-queue') },
        },
      );
    },
    onError: (err) => {
      setPendingDecision(null);
      toast.error(getErrorMessage(err, "We couldn't record your decision."));
    },
  });

  // Validate first, then open a confirmation — approve/reject can't be undone.
  const handleDecision = (decision: ReviewDecision) => {
    if (decision === 'REJECT' && !reviewComment.trim()) {
      setReviewCommentError('Add a comment explaining what needs fixing before sending it back.');
      return;
    }
    setReviewCommentError('');
    setPendingDecision(decision);
  };

  // Turn a rejected return into a fresh draft (a new version) and open it to edit.
  const reviseMutation = useMutation({
    mutationFn: () => submissionsApi.revise(id),
    onSuccess: (newDraft) => {
      invalidate();
      toast.success('A new draft is ready. Update it and resubmit.');
      navigate(`/submissions/${newDraft.id}`);
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't start a revision.")),
  });

  // Submitting runs the same check first, so there's one place errors ever appear (the panel
  // below the form). The sign dialog only opens once the return is clean — no more submitting
  // into a known error and seeing it echoed back in a second banner.
  const handleSubmit = async () => {
    // mutateAsync rejects if the check call fails; the mutation's onError already toasts, so we
    // swallow the rejection here to avoid an unhandled promise rejection out of the onClick.
    let result;
    try {
      result = await validateMutation.mutateAsync();
    } catch {
      return;
    }
    if (result.hard.length > 0) {
      toast.error('Please fix the highlighted issues before submitting.');
      return;
    }
    setSignedName('');
    setSignOpen(true);
  };

  // Whether this viewer may edit. Computed before the early returns, because the autosave and
  // unsaved-work hooks below can't be called conditionally.
  const loaded = detailQuery.data;
  const canEdit =
    !!loaded &&
    !!user &&
    isOperatorRole(user.role) &&
    loaded.status === 'DRAFT' &&
    loaded.period.status === 'OPEN';

  // The questionnaire is an hour of someone's work on an unreliable connection. It saves as they
  // type, and it refuses to let a stray click on the sidebar throw that away (§3.12).
  const autosave = useAutosave({
    data: values,
    enabled: canEdit,
    onSave: async () => {
      await submissionsApi.saveValues(id, buildValues());
      // Only the lists. Invalidating this return's own detail query would refetch it underneath
      // the person typing and reseed the form from the server, silently discarding every keystroke
      // made while the save was in flight — the exact work this autosave exists to protect.
      void qc.invalidateQueries({ queryKey: submissionKeys.lists });
    },
  });

  // The only work genuinely at risk is work autosave couldn't persist. Blocking navigation on
  // "there are edits" would fire on every screen exit, which trains people to click through it.
  const unsaved = useUnsavedChanges(canEdit && autosave.state.status === 'error');

  // A fresh server copy is by definition already saved.
  useEffect(() => {
    if (loaded) autosave.markClean();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  if (detailQuery.isLoading) return <PageLoading />;
  if (detailQuery.isError || !detailQuery.data) {
    return (
      <Page>
        <div className="space-y-4">
          <Alert tone="danger">
            {getErrorMessage(detailQuery.error, 'This return could not be found.')}
          </Alert>
          <Link
            to="/submissions"
            className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
          >
            <ChevronLeft size={16} aria-hidden /> Back to submissions
          </Link>
        </div>
      </Page>
    );
  }

  const submission = detailQuery.data;
  const userIsOperator = !!user && isOperatorRole(user.role);
  const editable = canEdit;

  // The reviewer decision panel shows only when the viewer's role acts on this return's
  // current stage and the return is still awaiting a decision.
  const viewerStage = user ? ROLE_TO_STAGE[user.role] : undefined;
  const canDecide =
    !!viewerStage &&
    viewerStage === submission.reviewStage &&
    (submission.status === 'SUBMITTED' || submission.status === 'UNDER_REVIEW');

  const getFV = (fieldId: string): FieldValueState => values[fieldId] ?? EMPTY_FV;
  const updateFV = (fieldId: string, patch: Partial<FieldValueState>) => {
    setValues((prev) => ({ ...prev, [fieldId]: { ...(prev[fieldId] ?? EMPTY_FV), ...patch } }));
    // Any edit makes the last check stale — clear the panel so old issues don't linger.
    if (validateMutation.data) validateMutation.reset();
  };

  // Which sections this return is actually being asked (VALIDATION_SPEC §3). The operator's type
  // is fixed; the services it offers are an answer on this very form, so this recomputes as they
  // tick and a section for a service they do not offer disappears while they watch.
  const declared = declaredServices(submission.template.sections, values);
  const sections = submission.template.sections.filter((s) =>
    sectionApplies(s, submission.entity.type, declared),
  );

  /**
   * Sections that no longer apply but still hold answers.
   *
   * Untick a service after filling its section in and the server will rightly refuse the return.
   * Hiding the section outright would then leave the operator told to clear figures they can no
   * longer see, so these stay on screen with a warning and a way to empty them.
   */
  const stranded = submission.template.sections.filter((s) =>
    isStrandedSection(s, submission.entity.type, declared, values),
  );

  /** Empty a stranded section, so the operator can act on the error rather than only read it. */
  const clearSection = (section: TemplateSection) => {
    setValues((prev) => {
      const next = { ...prev };
      for (const field of section.fields) next[field.id] = { ...EMPTY_FV };
      return next;
    });
    // Any edit makes the last check stale, exactly as a keystroke does.
    if (validateMutation.data) validateMutation.reset();
  };

  // ---------------------------------------------------------------------------
  // Field-level validation (FRONTEND_STANDARDS §3.12)
  //
  // The checker returns issues keyed by the field's `key`; the form is keyed by field `id`.
  // Bridging the two here is what turns "Fix these before submitting" from a list the operator
  // has to search eighty fields for into an error attached to the field it belongs to, and a
  // summary whose entries are links.
  // ---------------------------------------------------------------------------
  const allFields = sections.flatMap((s) => s.fields);
  const fieldByKey = new Map(allFields.map((f) => [f.key, f]));

  const issuesByFieldId = new Map<string, { message: string; severity: 'hard' | 'soft' }[]>();
  const collectIssues = (
    list: { fieldKey: string; message: string }[] | undefined,
    severity: 'hard' | 'soft',
  ) => {
    for (const issue of list ?? []) {
      const field = fieldByKey.get(issue.fieldKey);
      if (!field) continue;
      const existing = issuesByFieldId.get(field.id) ?? [];
      existing.push({ message: issue.message, severity });
      issuesByFieldId.set(field.id, existing);
    }
  };
  collectIssues(validateMutation.data?.hard, 'hard');
  collectIssues(validateMutation.data?.soft, 'soft');

  /** Move the user to a field the summary named, and put the cursor in it. */
  const focusField = (fieldKey: string) => {
    const field = fieldByKey.get(fieldKey);
    if (!field) return;
    const el = document.getElementById(field.id);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el?.focus({ preventScroll: true });
  };

  /** A field counts as answered once it holds a value or is explicitly marked unavailable. */
  const isAnswered = (field: TemplateField) => {
    const fv = getFV(field.id);
    return fv.isUnavailable || fv.valueText.trim() !== '';
  };

  const answeredCount = allFields.filter(isAnswered).length;
  const mandatoryRemaining = allFields.filter((f) => f.isMandatory && !isAnswered(f)).length;
  const isLongForm = allFields.length > LONG_FORM_FIELDS;

  const sectionSummaries = sections.map((section) => ({
    id: section.id,
    title: section.title,
    total: section.fields.length,
    answered: section.fields.filter(isAnswered).length,
    errors: section.fields.filter((f) =>
      (issuesByFieldId.get(f.id) ?? []).some((i) => i.severity === 'hard'),
    ).length,
  }));

  const renderControl = (field: TemplateField, invalid = false) => {
    const fv = getFV(field.id);
    const disabled = fv.isUnavailable;
    const common = { id: field.id, disabled, 'aria-invalid': invalid || undefined };

    if ((NUMERIC_TYPES as readonly string[]).includes(field.dataType)) {
      return (
        <Input
          {...common}
          type="number"
          step={field.dataType === 'INTEGER' ? '1' : 'any'}
          value={fv.valueText}
          onChange={(e) => updateFV(field.id, { valueText: e.target.value })}
        />
      );
    }
    if (field.dataType === 'DATE') {
      return (
        <DatePicker
          id={field.id}
          disabled={disabled}
          invalid={invalid}
          value={fv.valueText}
          onChange={(value) => updateFV(field.id, { valueText: value })}
        />
      );
    }
    if (field.dataType === 'BOOLEAN') {
      return (
        <Select
          id={field.id}
          disabled={disabled}
          invalid={invalid}
          value={fv.valueText}
          options={BOOLEAN_OPTIONS}
          onChange={(value) => updateFV(field.id, { valueText: value })}
        />
      );
    }
    if (field.dataType === 'REFERENCE') {
      const options = (field.referenceCategory && referenceOptions[field.referenceCategory]) ?? [
        { value: '', label: '—' },
      ];
      return (
        <Select
          id={field.id}
          disabled={disabled}
          invalid={invalid}
          value={fv.valueText}
          options={options}
          onChange={(value) => updateFV(field.id, { valueText: value })}
        />
      );
    }
    if (field.dataType === 'TEXTAREA') {
      return (
        <Textarea
          {...common}
          autoGrow
          rows={3}
          value={fv.valueText}
          onChange={(e) => updateFV(field.id, { valueText: e.target.value })}
        />
      );
    }
    return (
      <Input
        {...common}
        value={fv.valueText}
        onChange={(e) => updateFV(field.id, { valueText: e.target.value })}
      />
    );
  };

  const renderReadOnlyValue = (field: TemplateField) => {
    const fv = getFV(field.id);
    if (fv.isUnavailable) {
      return (
        <span className="text-gray-600">
          Data unavailable{fv.unavailableReason ? `: ${fv.unavailableReason}` : ''}
        </span>
      );
    }
    let display = fv.valueText;
    if (field.dataType === 'BOOLEAN') {
      display = fv.valueText === 'true' ? 'Yes' : fv.valueText === 'false' ? 'No' : '';
    } else if (field.dataType === 'DATE') {
      display = fv.valueText ? formatDate(fv.valueText) : '';
    } else if (field.dataType === 'REFERENCE' && field.referenceCategory) {
      const opt = referenceOptions[field.referenceCategory]?.find((o) => o.value === fv.valueText);
      display = opt && opt.value ? opt.label : fv.valueText;
    }
    if (display && field.unit) display = `${display} ${field.unit}`;
    return (
      <div className="text-gray-900">
        <span>{display || '—'}</span>
        {fv.otherText && <span className="block text-gray-600">Other: {fv.otherText}</span>}
      </div>
    );
  };

  const renderField = (field: TemplateField) => {
    const fv = getFV(field.id);
    const hint = fieldHint(field);

    if (!editable) {
      return (
        <div key={field.id} className="space-y-1">
          <p className="text-sm font-medium text-gray-700">
            {field.label}
            {field.isMandatory && <span className="ml-0.5 text-danger-600">*</span>}
          </p>
          {hint && <p className="text-xs text-gray-500">{hint}</p>}
          <div className="text-sm">{renderReadOnlyValue(field)}</div>
        </div>
      );
    }

    const issues = issuesByFieldId.get(field.id) ?? [];
    const hardIssue = issues.find((i) => i.severity === 'hard');
    const softIssue = issues.find((i) => i.severity === 'soft');

    return (
      <div
        key={field.id}
        // A long control needs the full row; a two-column grid squeezes it to nothing (§3.8).
        className={`space-y-2 ${field.dataType === 'TEXTAREA' ? 'sm:col-span-2' : ''}`}
      >
        <Field
          label={field.label}
          htmlFor={field.id}
          hint={hint}
          required={field.isMandatory}
          // The error sits directly under the control, in danger tone, with `aria-invalid` on
          // the input — one message pattern everywhere (§3.9).
          error={hardIssue?.message}
        >
          {renderControl(field, !!hardIssue)}
        </Field>

        {/* A soft issue is a question, not a blocker, so it reads as a caution and never carries
            the red error styling. */}
        {!hardIssue && softIssue && <p className="text-xs text-warning-700">{softIssue.message}</p>}

        {field.allowsOther && (
          <Input
            aria-label={`Other value for ${field.label}`}
            placeholder="Other (specify)"
            value={fv.otherText}
            disabled={fv.isUnavailable}
            onChange={(e) => updateFV(field.id, { otherText: e.target.value })}
          />
        )}
        <Checkbox
          checked={fv.isUnavailable}
          onChange={(checked) => updateFV(field.id, { isUnavailable: checked })}
          label="Data unavailable"
        />
        {fv.isUnavailable && (
          <Input
            aria-label={`Reason ${field.label} is unavailable`}
            placeholder="Reason data is unavailable"
            value={fv.unavailableReason}
            onChange={(e) => updateFV(field.id, { unavailableReason: e.target.value })}
          />
        )}
      </div>
    );
  };

  const warnings = submission.validationWarnings ?? [];
  const check = validateMutation.data;

  return (
    <Page width={editable && isLongForm ? 'wide' : 'default'} footer={false}>
      <PageHeader
        title={joinMeta(submission.template.name, submission.period.label)}
        meta={
          <>
            <Badge tone={SUBMISSION_STATUS_TONE[submission.status]}>
              {SUBMISSION_STATUS_LABELS[submission.status]}
            </Badge>
            {submission.isLate && <Badge tone="warning">Late</Badge>}
            {submission.referenceNumber && (
              <span className="text-sm font-medium text-gray-500">
                {submission.referenceNumber}
              </span>
            )}
          </>
        }
      />

      <div
        className={
          editable && isLongForm ? 'grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]' : undefined
        }
      >
        {/* In-page section navigation. A form this long needs to say where you are in it, how
            much of each section is answered, and which sections still have errors (§3.12). */}
        {editable && isLongForm && (
          <aside className="hidden lg:block">
            <nav
              aria-label="Sections"
              className="sticky top-4 space-y-1 rounded-xl border border-gray-200 bg-white p-3 shadow-sm"
            >
              <div className="px-2 pb-2">
                <Progress
                  label="Answered"
                  value={answeredCount}
                  max={allFields.length}
                  tone={mandatoryRemaining === 0 ? 'success' : 'info'}
                />
                {mandatoryRemaining > 0 && (
                  <p className="mt-1.5 text-xs text-gray-500">
                    {mandatoryRemaining} required {mandatoryRemaining === 1 ? 'answer' : 'answers'}{' '}
                    still to go.
                  </p>
                )}
              </div>
              {sectionSummaries.map((s) => (
                <a
                  key={s.id}
                  href={`#section-${s.id}`}
                  className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
                >
                  <span className="min-w-0 truncate">{s.title}</span>
                  {s.errors > 0 ? (
                    <Badge tone="danger">{s.errors}</Badge>
                  ) : (
                    <span className="shrink-0 text-xs text-gray-500">
                      {s.answered}/{s.total}
                    </span>
                  )}
                </a>
              ))}
            </nav>
          </aside>
        )}

        <div className="min-w-0 space-y-6">
          {/* The generic read-only line shows only when a status-specific alert below doesn't
              already explain it — i.e. for Authority viewers, or an operator's non-editable
              draft. For an operator's submitted/approved/rejected return the dedicated alert says
              it all, so this one would just be noise stacked on top. */}
          {!editable && (!userIsOperator || submission.status === 'DRAFT') && (
            <Alert tone="info">
              {readOnlyReason(
                submission.status,
                submission.period.status === 'OPEN',
                userIsOperator,
              )}
            </Alert>
          )}

          {userIsOperator && submission.status === 'REJECTED' && (
            <Alert tone="danger">
              <p className="font-medium">
                Returned by the Authority
                {submission.rejectionReason ? `: ${submission.rejectionReason}` : '.'}
              </p>
              {/* Only the current rejected version can be revised. If it's already been revised
                  (superseded), this is closed history — point the operator to the newer version. */}
              {submission.supersededBy ? (
                <p className="mt-2 text-sm">
                  You&apos;ve already revised this return.{' '}
                  <Link
                    to={`/submissions/${submission.supersededBy.id}`}
                    className="font-medium text-brand hover:underline"
                  >
                    Open the current version
                  </Link>
                  .
                </p>
              ) : (
                <div className="mt-3">
                  <Button
                    size="sm"
                    isLoading={reviseMutation.isPending}
                    onClick={() => reviseMutation.mutate()}
                  >
                    Revise &amp; resubmit
                  </Button>
                </div>
              )}
            </Alert>
          )}

          {userIsOperator &&
            (submission.status === 'SUBMITTED' || submission.status === 'UNDER_REVIEW') &&
            submission.reviewStage && (
              <p className="text-sm text-gray-600">
                It&apos;s with the Authority at the{' '}
                {REVIEW_STAGE_LABELS[submission.reviewStage].toLowerCase()} stage.
              </p>
            )}

          {userIsOperator && submission.status === 'APPROVED' && (
            <Alert tone="success">This return has been approved and is now locked.</Alert>
          )}

          {canDecide && (
            <Card>
              <h3 className="text-base font-semibold text-gray-900">
                Your decision
                {viewerStage ? ` at the ${REVIEW_STAGE_LABELS[viewerStage]} stage` : ''}
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                Approve to move this return to the next stage, or reject to send it back to the
                operator with your notes.
              </p>
              {warnings.length > 0 && (
                <p className="mt-2 text-sm text-warning-700">
                  This return was submitted with {warnings.length} note
                  {warnings.length === 1 ? '' : 's'} recorded. Check them above before you decide.
                </p>
              )}
              <div className="mt-4">
                <Field
                  label="Comment"
                  htmlFor="review-comment"
                  error={reviewCommentError}
                  hint="Required when you reject. Shared with the operator."
                >
                  <Textarea
                    id="review-comment"
                    rows={3}
                    autoGrow
                    aria-invalid={!!reviewCommentError || undefined}
                    value={reviewComment}
                    onChange={(e) => {
                      setReviewComment(e.target.value);
                      if (reviewCommentError) setReviewCommentError('');
                    }}
                  />
                </Field>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <Button
                  variant="danger"
                  isLoading={decisionMutation.isPending && decisionMutation.variables === 'REJECT'}
                  onClick={() => handleDecision('REJECT')}
                >
                  Reject
                </Button>
                <Button
                  isLoading={decisionMutation.isPending && decisionMutation.variables === 'APPROVE'}
                  onClick={() => handleDecision('APPROVE')}
                >
                  Approve
                </Button>
              </div>
            </Card>
          )}

          {submission.submittedAt && (
            <Card>
              <h3 className="text-base font-semibold text-gray-900">Submission record</h3>
              <p className="mt-1 text-sm text-gray-500">
                Who signed and filed this return, and when.
              </p>
              <div className="mt-4">
                <DescriptionList
                  items={[
                    { label: 'Reference number', value: submission.referenceNumber },
                    { label: 'Submitted on', value: formatDateTime(submission.submittedAt) },
                    { label: 'Signed by (e-signature)', value: submission.signedName },
                    {
                      label: 'Submitted by (account)',
                      value: submission.signedBy
                        ? joinMeta(
                            `${submission.signedBy.firstName} ${submission.signedBy.lastName}`,
                            submission.signedBy.email,
                            ROLE_LABELS[submission.signedBy.role],
                          )
                        : null,
                      full: true,
                    },
                    { label: 'Signed on', value: formatDateTime(submission.signedAt) },
                    {
                      label: 'Filed',
                      value: submission.isLate ? 'Late, after the due date' : 'On time',
                    },
                    { label: 'Due date', value: formatDate(submission.period.dueDate) },
                  ]}
                />
              </div>
            </Card>
          )}

          {!editable && warnings.length > 0 && (
            <Alert tone="warning">
              <p className="font-medium">Notes recorded when this return was submitted:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {warnings.map((w, i) => (
                  <li key={`${w.fieldKey}-${i}`}>{w.message}</li>
                ))}
              </ul>
            </Alert>
          )}

          {sections.map((section) => (
            <Card key={section.id} id={`section-${section.id}`}>
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-gray-900">{section.title}</h3>
                {section.description && (
                  <p className="text-sm text-gray-500">{section.description}</p>
                )}
              </div>
              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                {section.fields.map((field) => renderField(field))}
              </div>
            </Card>
          ))}

          {stranded.map((section) => (
            <Card key={section.id} id={`section-${section.id}`}>
              <Alert tone="warning">
                <p className="font-medium">
                  This section is only for operators offering{' '}
                  {humaniseService(section.requiredServiceCode)}.
                </p>
                <p className="mt-1 text-sm">
                  You have not ticked that service in Section 1, but answers are still recorded
                  here. Either tick the service, or clear these answers. The return cannot be filed
                  while both are true.
                </p>
              </Alert>
              <div className="mt-4 flex items-center justify-between gap-4">
                <h3 className="text-base font-semibold text-gray-900">{section.title}</h3>
                {canEdit && (
                  <Button variant="secondary" size="sm" onClick={() => clearSection(section)}>
                    Clear this section
                  </Button>
                )}
              </div>
              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                {section.fields.map((field) => renderField(field))}
              </div>
            </Card>
          ))}

          {viewerIsAuthority && historyQuery.data && historyQuery.data.steps.length > 0 && (
            <Card>
              <h3 className="text-base font-semibold text-gray-900">Review history</h3>
              <p className="mt-1 text-sm text-gray-500">
                Each decision recorded as this return moved through the review stages.
              </p>
              <div className="mt-4">
                <Timeline
                  events={historyQuery.data.steps.map((step) => ({
                    id: step.id,
                    tone: step.decision === 'APPROVE' ? 'success' : 'danger',
                    title: joinMeta(
                      REVIEW_STAGE_LABELS[step.stage],
                      step.decision === 'APPROVE' ? 'Approved' : 'Rejected',
                    ),
                    when: formatDateTime(step.createdAt),
                    actor: step.actor
                      ? joinMeta(
                          `${step.actor.firstName} ${step.actor.lastName}`,
                          ROLE_LABELS[step.actor.role],
                        )
                      : 'System',
                    body: step.comment,
                  }))}
                />
              </div>
            </Card>
          )}

          {/* The validation summary is a list of links. Naming a problem without taking the
              operator to it is the gap §3.12 exists to close. */}
          {editable && check && (
            <div className="space-y-3">
              {check.hard.length === 0 && check.soft.length === 0 && (
                <Alert tone="success">All checks passed. This return is ready to submit.</Alert>
              )}
              {check.hard.length > 0 && (
                <Alert tone="danger">
                  <p className="font-medium">Fix these before submitting:</p>
                  <ul className="mt-1 space-y-1">
                    {check.hard.map((w, i) => (
                      <li key={`hard-${w.fieldKey}-${i}`}>
                        <button
                          type="button"
                          onClick={() => focusField(w.fieldKey)}
                          className="text-left underline underline-offset-2 hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-danger-500/40"
                        >
                          {w.message}
                        </button>
                      </li>
                    ))}
                  </ul>
                </Alert>
              )}
              {check.soft.length > 0 && (
                <Alert tone="warning">
                  <p className="font-medium">Warnings. These won&apos;t block submitting:</p>
                  <ul className="mt-1 space-y-1">
                    {check.soft.map((w, i) => (
                      <li key={`soft-${w.fieldKey}-${i}`}>
                        <button
                          type="button"
                          onClick={() => focusField(w.fieldKey)}
                          className="text-left underline underline-offset-2 hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-warning-500/40"
                        >
                          {w.message}
                        </button>
                      </li>
                    ))}
                  </ul>
                </Alert>
              )}
            </div>
          )}

          {/* Offered only while the return can still be changed: there is nothing to load into a
              submitted one, and the Authority does not fill returns in. */}
          {editable && <WorkbookPanel submissionId={submission.id} />}

          <AttachmentsSection
            submissionId={submission.id}
            editable={editable}
            initial={submission.attachments ?? []}
          />
        </div>
      </div>

      {/* The action bar sticks to the bottom of the editor, so Check and Submit are always one
          click away rather than eighty fields down (§3.12). */}
      {editable && (
        <div className="sticky bottom-0 -mx-4 mt-6 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-4">
              <SaveStatus state={autosave.state} onRetry={() => void autosave.saveNow()} />
              {isLongForm && (
                <span className="hidden text-xs text-gray-500 sm:inline">
                  {answeredCount} of {allFields.length} answered
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                isLoading={validateMutation.isPending}
                onClick={() => validateMutation.mutate()}
              >
                Check answers
              </Button>
              <Button isLoading={validateMutation.isPending} onClick={handleSubmit}>
                Submit
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingDecision !== null}
        title={
          pendingDecision === 'REJECT'
            ? 'Reject this return?'
            : submission.reviewStage === 'APPROVER'
              ? 'Approve and lock this return?'
              : 'Approve this return?'
        }
        message={
          pendingDecision === 'REJECT'
            ? 'This sends the return back to the operator with your comment. They will need to revise and resubmit it. This cannot be undone.'
            : submission.reviewStage === 'APPROVER'
              ? 'This is the final approval. The return will be locked and can no longer be changed. This cannot be undone.'
              : 'This moves the return on to the next review stage. This cannot be undone.'
        }
        tone={pendingDecision === 'REJECT' ? 'danger' : 'primary'}
        confirmLabel={pendingDecision === 'REJECT' ? 'Reject and return' : 'Approve'}
        isLoading={decisionMutation.isPending}
        onConfirm={() => pendingDecision && decisionMutation.mutate(pendingDecision)}
        onClose={() => setPendingDecision(null)}
      />

      {/* Autosave couldn't reach the server, so leaving really would lose the last edits (§3.12). */}
      <ConfirmDialog
        open={unsaved.isBlocked}
        title="Leave without saving?"
        message="Your last changes couldn't be saved. The connection may have dropped. If you leave now, those changes are lost."
        tone="danger"
        confirmLabel="Leave anyway"
        cancelLabel="Stay on this page"
        onConfirm={unsaved.confirmLeave}
        onClose={unsaved.cancelLeave}
      />

      <Modal
        open={signOpen}
        title="Submit return"
        onClose={() => setSignOpen(false)}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setSignOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!signedName.trim()}
              isLoading={submitMutation.isPending}
              onClick={() => submitMutation.mutate()}
            >
              Submit return
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          <p className="text-sm text-gray-600">
            By submitting, you confirm the information you&apos;ve entered is accurate and complete.
          </p>
          <Field label="Full name (e-signature)" htmlFor="signed-name" required>
            <Input
              id="signed-name"
              placeholder="e.g. Grace Deng"
              value={signedName}
              onChange={(e) => setSignedName(e.target.value)}
            />
          </Field>
        </div>
      </Modal>
    </Page>
  );
}
