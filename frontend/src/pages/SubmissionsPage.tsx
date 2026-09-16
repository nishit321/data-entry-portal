import { useMemo, useState } from 'react';
import { strings } from '../lib/strings';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Download, Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Combobox,
  FilterField,
  ConfirmDialog,
  DateRangeFilter,
  IconButton,
  ListShell,
  Modal,
  PageHeader,
  RelativeTime,
  Select,
  Spinner,
  Tabs,
  useToast,
  type ActiveFilterChip,
  type SelectOption,
} from '../components/ui';
import { DataTable, type Column, type Density } from '../components/DataTable';
import { submissionsApi, submissionKeys, type SubmissionListParams } from '../lib/submissions.api';
import { useListParams } from '../hooks/useListParams';
import { useCsvExport } from '../hooks/useCsvExport';
import type { CsvColumn } from '../lib/csv';
import { entityPicker, periodPicker, templatePicker } from '../lib/pickers';
import { getErrorMessage } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { SUBMISSION_STATUS_TONE } from '../lib/status';
import { formatDate, formatDateTime, joinMeta } from '../lib/format';
import {
  ENTITY_TYPE_LABELS,
  isOperatorRole,
  REVIEW_STAGE_LABELS,
  SUBMISSION_STATUS_LABELS,
  SUBMISSION_STATUSES,
  type SubmissionListRow,
  type SubmissionStatus,
} from '../lib/types';

const STATUS_FILTER_OPTIONS: SelectOption[] = [
  { value: '', label: 'All statuses' },
  ...SUBMISSION_STATUSES.map((s) => ({ value: s, label: SUBMISSION_STATUS_LABELS[s] })),
];

const LATE_FILTER_OPTIONS: SelectOption[] = [
  { value: '', label: 'On time and late' },
  { value: 'false', label: 'On time only' },
  { value: 'true', label: 'Late only' },
];

/**
 * Saved views (FRONTEND_STANDARDS §3.11). "What am I still working on" and "what has come back to
 * me" are the two questions an operator opens this screen with; making them assemble a filter
 * combination to ask either one is work the product should have done.
 */
type ViewId = 'all' | 'drafts' | 'inReview' | 'returned';

const VIEW_STATUS: Record<ViewId, SubmissionStatus | ''> = {
  all: '',
  drafts: 'DRAFT',
  inReview: 'UNDER_REVIEW',
  returned: 'REJECTED',
};

export function SubmissionsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const userIsOperator = !!user && isOperatorRole(user.role);
  // Cross-entity filters are for Authority triage across many operators; operators are already
  // scoped to their own returns, so they only get status / timeliness / date.
  const isAuthority = !userIsOperator;

  const list = useListParams({
    defaultSort: 'createdAt',
    defaultOrder: 'desc',
    preferenceKey: 'submissions',
    filters: {
      status: '',
      entityId: '',
      periodId: '',
      templateId: '',
      isLate: '',
      submittedFrom: '',
      submittedTo: '',
    },
  });

  const [density, setDensity] = useState<Density>('comfortable');
  const [confirming, setConfirming] = useState<SubmissionListRow | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');

  const params: SubmissionListParams = {
    page: list.page,
    pageSize: list.pageSize,
    sort: list.sort as SubmissionListParams['sort'],
    order: list.order,
    search: list.search || undefined,
    status: (list.filters.status || undefined) as SubmissionStatus | undefined,
    entityId: list.filters.entityId || undefined,
    periodId: list.filters.periodId || undefined,
    templateId: list.filters.templateId || undefined,
    isLate: list.filters.isLate === '' ? undefined : list.filters.isLate === 'true',
    submittedFrom: list.filters.submittedFrom || undefined,
    submittedTo: list.filters.submittedTo || undefined,
  };

  const listQuery = useQuery({
    queryKey: submissionKeys.list(params),
    queryFn: () => submissionsApi.list(params),
  });

  // Startable periods — fetched only while the "Start a return" picker is open.
  const periodsQuery = useQuery({
    queryKey: ['submissions', 'startable-periods'],
    queryFn: () => submissionsApi.startablePeriods(),
    enabled: startOpen,
  });

  const openDraftMutation = useMutation({
    mutationFn: (periodId: string) => submissionsApi.openDraft(periodId),
    onSuccess: (submission) => {
      setStartOpen(false);
      navigate(`/submissions/${submission.id}`);
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't start your return")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => submissionsApi.remove(id),
    onSuccess: () => {
      void listQuery.refetch();
      setConfirming(null);
      toast.success('Draft deleted.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't delete the draft")),
  });

  const openStart = () => {
    setSelectedPeriodId('');
    setStartOpen(true);
  };

  const periods = periodsQuery.data ?? [];
  const periodOptions: SelectOption[] = periods.map((p) => ({
    value: p.id,
    label: joinMeta(p.label, p.template.name, `due ${formatDate(p.dueDate)}`),
  }));

  const rows = listQuery.data?.data ?? [];

  const activeView: ViewId =
    (Object.keys(VIEW_STATUS) as ViewId[]).find(
      (id) => id !== 'all' && VIEW_STATUS[id] === list.filters.status,
    ) ?? 'all';

  const activeFilters: ActiveFilterChip[] = useMemo(() => {
    const chips: ActiveFilterChip[] = [];
    if (list.search)
      chips.push({
        key: 'search',
        label: `Matching ${list.search}`,
        onRemove: () => list.setSearch(''),
      });
    // Status is expressed through the tabs, so it isn't repeated as a chip.
    if (list.filters.entityId)
      chips.push({
        key: 'entityId',
        label: 'One entity',
        onRemove: () => list.clearFilter('entityId'),
      });
    if (list.filters.periodId)
      chips.push({
        key: 'periodId',
        label: 'One period',
        onRemove: () => list.clearFilter('periodId'),
      });
    if (list.filters.templateId)
      chips.push({
        key: 'templateId',
        label: 'One template',
        onRemove: () => list.clearFilter('templateId'),
      });
    if (list.filters.isLate)
      chips.push({
        key: 'isLate',
        label: list.filters.isLate === 'true' ? 'Late only' : 'On time only',
        onRemove: () => list.clearFilter('isLate'),
      });
    if (list.filters.submittedFrom || list.filters.submittedTo)
      chips.push({
        key: 'submitted',
        label: `Submitted ${list.filters.submittedFrom || 'any date'} to ${list.filters.submittedTo || 'now'}`,
        onRemove: () => list.setFilters({ submittedFrom: '', submittedTo: '' }),
      });
    return chips;
  }, [list]);

  /*
   * The filtered list, as a spreadsheet.
   *
   * A regulator reconciles this data offline: against last quarter's file, against a letter from
   * an operator, against a figure somebody quoted in a meeting. "Read it off the screen" is not a
   * workflow, and it is why FRONTEND_STANDARDS §3.11 asks for this at all.
   *
   * The columns are the ones on screen plus the two a spreadsheet needs and a table does not: the
   * reference number, which is what an operator quotes back, and how many answers a return
   * carries, which is how an empty draft is told from a filled one without opening it.
   */
  const exportCsv = useCsvExport({
    subject: 'submissions',
    noun: 'returns',
    fetchPage: (page, pageSize) => submissionsApi.list({ ...params, page, pageSize }),
    columns: [
      { header: 'Reference', value: (r) => r.referenceNumber ?? '' },
      { header: 'Operator', value: (r) => r.entity.name },
      { header: 'Operator type', value: (r) => ENTITY_TYPE_LABELS[r.entity.type] },
      { header: 'Period', value: (r) => r.period.label },
      { header: 'Deadline', value: (r) => formatDate(r.period.dueDate) },
      { header: 'Questionnaire', value: (r) => r.template.name },
      { header: 'Status', value: (r) => SUBMISSION_STATUS_LABELS[r.status] },
      {
        header: 'Review stage',
        value: (r) => (r.reviewStage ? REVIEW_STAGE_LABELS[r.reviewStage] : ''),
      },
      // Yes or no rather than TRUE/FALSE: a spreadsheet column of booleans reads as a setting,
      // and this is a fact about a filing.
      { header: 'Filed late', value: (r) => (r.isLate ? 'Yes' : 'No') },
      { header: 'Filed on', value: (r) => (r.submittedAt ? formatDateTime(r.submittedAt) : '') },
      { header: 'Answers', value: (r) => r._count.values },
    ] satisfies CsvColumn<SubmissionListRow>[],
  });

  const columns: Column<SubmissionListRow>[] = [
    {
      header: 'Reference',
      sortKey: 'referenceNumber',
      width: '11rem',
      cell: (s) => <span className="font-medium text-gray-900">{s.referenceNumber ?? '—'}</span>,
    },
    ...(isAuthority
      ? [
          {
            header: 'Entity',
            width: '14rem',
            cell: (s: SubmissionListRow) => <span className="text-gray-700">{s.entity.name}</span>,
          },
        ]
      : []),
    {
      header: 'Template',
      hideOnMobile: true,
      cell: (s) => <span className="text-gray-700">{s.template.name}</span>,
    },
    {
      header: 'Period',
      width: '13rem',
      cell: (s) => (
        <div className="min-w-0">
          <div className="truncate text-gray-700">{s.period.label}</div>
          <div className="truncate text-xs text-gray-500">Due {formatDate(s.period.dueDate)}</div>
        </div>
      ),
    },
    {
      header: 'Status',
      sortKey: 'status',
      width: '12rem',
      cell: (s) => (
        <div>
          <Badge tone={SUBMISSION_STATUS_TONE[s.status]}>
            {SUBMISSION_STATUS_LABELS[s.status]}
          </Badge>
          {/* While in review, show which stage it's waiting on so it's clear where it sits. */}
          {s.reviewStage && (s.status === 'SUBMITTED' || s.status === 'UNDER_REVIEW') && (
            <div className="mt-0.5 truncate text-xs text-gray-500">
              With {REVIEW_STAGE_LABELS[s.reviewStage]}
            </div>
          )}
        </div>
      ),
    },
    {
      header: 'Late',
      width: '6rem',
      cell: (s) =>
        s.isLate ? <Badge tone="warning">Late</Badge> : <span className="text-gray-300">—</span>,
    },
    {
      header: 'Submitted',
      sortKey: 'submittedAt',
      width: '10rem',
      cell: (s) => <RelativeTime value={s.submittedAt} className="text-gray-500" />,
    },
    {
      header: 'Actions',
      align: 'right',
      width: '7rem',
      cell: (s) => (
        <div className="flex justify-end gap-1">
          {/* One shape for row actions across every table: icon buttons with tooltips (§3.6).
              "Continue" (edit) only for the owning operator on their own draft; everyone else,
              and every non-draft status, just views. */}
          {userIsOperator && s.status === 'DRAFT' ? (
            <>
              <IconButton
                icon={Pencil}
                label="Continue this draft"
                onClick={() => navigate(`/submissions/${s.id}`)}
              />
              <IconButton
                icon={Trash2}
                label="Delete this draft"
                variant="danger"
                onClick={() => setConfirming(s)}
              />
            </>
          ) : (
            <IconButton
              icon={Eye}
              label="View this return"
              onClick={() => navigate(`/submissions/${s.id}`)}
            />
          )}
        </div>
      ),
    },
  ];

  return (
    <ListShell
      header={
        <div className="space-y-4">
          <PageHeader
            description="Fill in a questionnaire for a reporting period, then submit your return to the Authority."
            actions={
              <>
                <Button
                  variant="secondary"
                  icon={Download}
                  isLoading={exportCsv.isPending}
                  onClick={exportCsv.run}
                >
                  Export
                </Button>
                {userIsOperator && (
                  <Button onClick={openStart} icon={Plus}>
                    Start a return
                  </Button>
                )}
              </>
            }
          />
          <Tabs
            aria-label="Saved views"
            value={activeView}
            onChange={(view: ViewId) => list.setFilters({ status: VIEW_STATUS[view] })}
            tabs={[
              { id: 'all', label: 'All returns' },
              { id: 'drafts', label: 'Drafts' },
              { id: 'inReview', label: 'In review' },
              { id: 'returned', label: 'Sent back' },
            ]}
          />
        </div>
      }
      search={{
        value: list.search,
        onChange: list.setSearch,
        placeholder: 'Search by reference number',
        label: 'Search returns',
      }}
      filters={
        <>
          {isAuthority && (
            <>
              <FilterField label={strings.field.entity} width="lg">
                <Combobox
                  aria-label={strings.filter.byEntity}
                  emptyLabel="All entities"
                  placeholder={strings.search.entities}
                  source={entityPicker}
                  value={list.filters.entityId}
                  onChange={(entityId) => list.setFilters({ entityId })}
                />
              </FilterField>
              <FilterField label={strings.field.reportingPeriod} width="lg">
                <Combobox
                  aria-label="Filter by reporting period"
                  emptyLabel="All periods"
                  placeholder={strings.search.periods}
                  source={periodPicker}
                  value={list.filters.periodId}
                  onChange={(periodId) => list.setFilters({ periodId })}
                />
              </FilterField>
              <FilterField label={strings.field.template} width="lg">
                <Combobox
                  aria-label="Filter by template"
                  emptyLabel="All templates"
                  placeholder="Search templates…"
                  source={templatePicker}
                  value={list.filters.templateId}
                  onChange={(templateId) => list.setFilters({ templateId })}
                />
              </FilterField>
            </>
          )}
          <FilterField label={strings.field.status} width="sm">
            <Select
              aria-label={strings.filter.byStatus}
              value={list.filters.status}
              options={STATUS_FILTER_OPTIONS}
              onChange={(status) => list.setFilters({ status })}
            />
          </FilterField>
          <FilterField label="Timeliness" width="sm">
            <Select
              aria-label="Filter by timeliness"
              value={list.filters.isLate}
              options={LATE_FILTER_OPTIONS}
              onChange={(isLate) => list.setFilters({ isLate })}
            />
          </FilterField>
          <DateRangeFilter
            label="Submitted"
            fromLabel="Submitted from"
            toLabel="Submitted to"
            value={{ from: list.filters.submittedFrom, to: list.filters.submittedTo }}
            onChange={(range) =>
              list.setFilters({ submittedFrom: range.from, submittedTo: range.to })
            }
          />
        </>
      }
      activeFilters={activeFilters}
      onClearFilters={list.clearAll}
      meta={listQuery.data?.meta}
      onPageChange={list.setPage}
      onPageSizeChange={list.setPageSize}
      refreshing={listQuery.isFetching && !listQuery.isLoading}
      onDensityChange={setDensity}
      footnote={
        <p className="flex items-center gap-1.5 text-xs text-gray-500">
          <ClipboardList size={13} aria-hidden /> Operators complete and submit returns; the
          Authority reviews them read-only.
        </p>
      }
    >
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(s) => s.id}
        loading={listQuery.isLoading}
        refreshing={listQuery.isFetching && !listQuery.isLoading}
        error={listQuery.isError}
        onRetry={() => void listQuery.refetch()}
        sort={list.sort}
        order={list.order}
        onSortChange={list.setSort}
        density={density}
        onRowClick={(s) => navigate(`/submissions/${s.id}`)}
        emptyMessage={
          list.hasActiveFilters
            ? 'No returns match your filters.'
            : userIsOperator
              ? "You haven't started a return yet."
              : 'No returns have been filed yet.'
        }
        emptyAction={
          list.hasActiveFilters ? (
            <Button variant="secondary" onClick={list.clearAll}>
              {strings.action.clearFilters}
            </Button>
          ) : userIsOperator ? (
            <Button variant="secondary" onClick={openStart}>
              Start a return
            </Button>
          ) : undefined
        }
      />

      <Modal
        open={startOpen}
        title="Start a return"
        onClose={() => setStartOpen(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setStartOpen(false)}>
              {strings.action.cancel}
            </Button>
            <Button
              type="button"
              disabled={!selectedPeriodId}
              isLoading={openDraftMutation.isPending}
              onClick={() => selectedPeriodId && openDraftMutation.mutate(selectedPeriodId)}
            >
              Open draft
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          {periodsQuery.isLoading ? (
            <Spinner label="Loading open periods…" />
          ) : periods.length === 0 ? (
            <Alert tone="info">
              You&apos;ve already started a return for every open period that applies to you. Open
              drafts are in the list below under Continue.
            </Alert>
          ) : (
            <>
              <p className="text-sm text-gray-600">
                Pick a reporting period you haven&apos;t started yet. We&apos;ll open a fresh draft
                for you to fill in.
              </p>
              <Select
                id="start-period"
                aria-label={strings.field.reportingPeriod}
                value={selectedPeriodId}
                options={periodOptions}
                placeholder="Select a reporting period"
                onChange={setSelectedPeriodId}
              />
            </>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirming}
        title="Delete draft"
        message={
          confirming
            ? `Delete this draft return for ${confirming.period.label}? This cannot be undone.`
            : ''
        }
        tone="danger"
        isLoading={deleteMutation.isPending}
        onConfirm={() => confirming && deleteMutation.mutate(confirming.id)}
        onClose={() => setConfirming(null)}
      />
    </ListShell>
  );
}
