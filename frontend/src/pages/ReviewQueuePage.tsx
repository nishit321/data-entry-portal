import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ClipboardCheck } from 'lucide-react';
import {
  Badge,
  Combobox,
  IconButton,
  FilterField,
  ListShell,
  PageHeader,
  RelativeTime,
  Select,
  type ActiveFilterChip,
  type SelectOption,
} from '../components/ui';
import { DataTable, type Column, type Density } from '../components/DataTable';
import { workflowApi, workflowKeys, type WorkflowQueueParams } from '../lib/workflow.api';
import { useListParams } from '../hooks/useListParams';
import { entityPicker, periodPicker, templatePicker } from '../lib/pickers';
import { useAuth } from '../context/AuthContext';
import { formatDate } from '../lib/format';
import { REVIEW_STAGE_LABELS, REVIEW_STAGES, type SubmissionListRow } from '../lib/types';

const LATE_FILTER_OPTIONS: SelectOption[] = [
  { value: '', label: 'On time and late' },
  { value: 'false', label: 'On time only' },
  { value: 'true', label: 'Late only' },
];

/** Past this many days waiting, a return is called out rather than left to be noticed. */
const AGEING_DAYS = 5;

function daysWaiting(submittedAt?: string | null): number | null {
  if (!submittedAt) return null;
  const submitted = new Date(submittedAt);
  if (Number.isNaN(submitted.getTime())) return null;
  return Math.floor((Date.now() - submitted.getTime()) / (24 * 60 * 60 * 1000));
}

export function ReviewQueuePage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const list = useListParams({
    defaultSort: 'submittedAt',
    defaultOrder: 'asc',
    preferenceKey: 'review-queue',
    filters: { entityId: '', periodId: '', templateId: '', isLate: '' },
  });
  const [density, setDensity] = useState<Density>('comfortable');

  const params: WorkflowQueueParams = {
    page: list.page,
    pageSize: list.pageSize,
    sort: list.sort as WorkflowQueueParams['sort'],
    order: list.order,
    search: list.search || undefined,
    entityId: list.filters.entityId || undefined,
    periodId: list.filters.periodId || undefined,
    templateId: list.filters.templateId || undefined,
    isLate: list.filters.isLate === '' ? undefined : list.filters.isLate === 'true',
  };

  const listQuery = useQuery({
    queryKey: workflowKeys.queue(params),
    queryFn: () => workflowApi.queue(params),
  });

  // The reviewer's own stage label (Checker / Verifier / Approver), for the header copy.
  const stageLabel =
    user && (REVIEW_STAGES as readonly string[]).includes(user.role)
      ? REVIEW_STAGE_LABELS[user.role as (typeof REVIEW_STAGES)[number]]
      : null;

  const rows = listQuery.data?.data ?? [];
  const oldest = rows.reduce<number | null>((worst, row) => {
    const age = daysWaiting(row.submittedAt);
    return age !== null && (worst === null || age > worst) ? age : worst;
  }, null);

  const activeFilters: ActiveFilterChip[] = useMemo(() => {
    const chips: ActiveFilterChip[] = [];
    if (list.search) {
      chips.push({
        key: 'search',
        label: `Matching ${list.search}`,
        onRemove: () => list.setSearch(''),
      });
    }
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
    return chips;
  }, [list]);

  const columns: Column<SubmissionListRow>[] = [
    {
      header: 'Reference',
      sortKey: 'referenceNumber',
      width: '11rem',
      cell: (s) => <span className="font-medium text-gray-900">{s.referenceNumber ?? '—'}</span>,
    },
    {
      header: 'Entity',
      width: '16rem',
      cell: (s) => <span className="text-gray-700">{s.entity.name}</span>,
    },
    {
      header: 'Template',
      hideOnMobile: true,
      cell: (s) => <span className="text-gray-700">{s.template.name}</span>,
    },
    {
      header: 'Period',
      width: '14rem',
      cell: (s) => (
        <div className="min-w-0">
          <div className="truncate text-gray-700">{s.period.label}</div>
          <div className="truncate text-xs text-gray-500">Due {formatDate(s.period.dueDate)}</div>
        </div>
      ),
    },
    {
      header: 'Waiting',
      sortKey: 'submittedAt',
      width: '10rem',
      cell: (s) => {
        const age = daysWaiting(s.submittedAt);
        return (
          <div className="min-w-0">
            <RelativeTime value={s.submittedAt} className="text-gray-600" />
            {age !== null && age >= AGEING_DAYS && (
              <div className="mt-0.5">
                <Badge tone="warning">{age} days</Badge>
              </div>
            )}
          </div>
        );
      },
    },
    {
      header: 'Late',
      width: '6rem',
      cell: (s) =>
        s.isLate ? <Badge tone="warning">Late</Badge> : <span className="text-gray-300">—</span>,
    },
    {
      header: 'Actions',
      align: 'right',
      width: '6rem',
      cell: (s) => (
        <div className="flex justify-end">
          {/* Icon + tooltip, the same shape as every other table's row actions (§3.6).
              `ClipboardCheck` rather than `Eye`: opening a return from the queue is an act of
              reviewing it, not just reading it, and the vocabulary should say which. */}
          <IconButton
            icon={ClipboardCheck}
            label="Review this return"
            onClick={() => navigate(`/submissions/${s.id}`)}
          />
        </div>
      ),
    },
  ];

  return (
    <ListShell
      header={
        <PageHeader
          description={
            stageLabel
              ? `Returns waiting for your review at the ${stageLabel.toLowerCase()} stage.`
              : 'Returns waiting for your review.'
          }
          meta={
            oldest !== null && oldest >= AGEING_DAYS ? (
              <Badge tone="warning">Oldest has waited {oldest} days</Badge>
            ) : undefined
          }
        />
      }
      search={{
        value: list.search,
        onChange: list.setSearch,
        placeholder: 'Search by reference number',
        label: 'Search the review queue',
      }}
      filters={
        <>
          <FilterField label="Entity" width="lg">
            <Combobox
              aria-label="Filter by entity"
              emptyLabel="All entities"
              placeholder="Search entities…"
              source={entityPicker}
              value={list.filters.entityId}
              onChange={(entityId) => list.setFilters({ entityId })}
            />
          </FilterField>
          <FilterField label="Reporting period" width="lg">
            <Combobox
              aria-label="Filter by reporting period"
              emptyLabel="All periods"
              placeholder="Search periods…"
              source={periodPicker}
              value={list.filters.periodId}
              onChange={(periodId) => list.setFilters({ periodId })}
            />
          </FilterField>
          <FilterField label="Template" width="lg">
            <Combobox
              aria-label="Filter by template"
              emptyLabel="All templates"
              placeholder="Search templates…"
              source={templatePicker}
              value={list.filters.templateId}
              onChange={(templateId) => list.setFilters({ templateId })}
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
        </>
      }
      activeFilters={activeFilters}
      onClearFilters={list.clearAll}
      meta={listQuery.data?.meta}
      onPageChange={list.setPage}
      onPageSizeChange={list.setPageSize}
      refreshing={listQuery.isFetching && !listQuery.isLoading}
      onDensityChange={setDensity}
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
            ? 'No returns match these filters.'
            : 'Nothing waiting for your review right now.'
        }
      />
    </ListShell>
  );
}
