import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import {
  Badge,
  Button,
  Combobox,
  FilterField,
  ListShell,
  Modal,
  PageHeader,
  Select,
  Textarea,
  useToast,
  type ActiveFilterChip,
  type SelectOption,
} from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import { PenaltySchedulePanel } from '../components/PenaltySchedulePanel';
import {
  enforcementApi,
  enforcementKeys,
  type EnforcementListParams,
} from '../lib/enforcement.api';
import { useListParams } from '../hooks/useListParams';
import { entityPicker, periodPicker } from '../lib/pickers';
import { getErrorMessage } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { ENFORCEMENT_STATUS_TONE } from '../lib/status';
import { formatDate, formatSsp } from '../lib/format';
import {
  ENFORCEMENT_REASON_LABELS,
  ENFORCEMENT_STATUS_LABELS,
  ENFORCEMENT_STATUSES,
  ENTITY_TYPE_LABELS,
  isOperatorRole,
  type EnforcementCase,
  type EnforcementStatus,
} from '../lib/types';

const STATUS_FILTER_OPTIONS: SelectOption[] = [
  { value: '', label: 'All statuses' },
  ...ENFORCEMENT_STATUSES.map((s) => ({ value: s, label: ENFORCEMENT_STATUS_LABELS[s] })),
];

/** The action the manager is confirming in the note modal. */
type PendingAction = { case: EnforcementCase; kind: 'resolve' | 'waive' } | null;

export function EnforcementPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();

  // Only Authority managers can act; operators (and other roles) get a read-only view of their own.
  const canManage = user?.role === 'ADMIN' || user?.role === 'SUPERVISOR';
  const isOperator = !!user && isOperatorRole(user.role);

  const list = useListParams({
    defaultSort: 'openedAt',
    defaultOrder: 'desc',
    preferenceKey: 'enforcement',
    filters: { status: '', entityId: '', periodId: '' },
  });

  const [pending, setPending] = useState<PendingAction>(null);
  const [note, setNote] = useState('');

  const params: EnforcementListParams = {
    page: list.page,
    pageSize: list.pageSize,
    sort: list.sort as EnforcementListParams['sort'],
    order: list.order,
    status: (list.filters.status || undefined) as EnforcementStatus | undefined,
    entityId: list.filters.entityId || undefined,
    periodId: list.filters.periodId || undefined,
  };

  const listQuery = useQuery({
    queryKey: enforcementKeys.list(params),
    queryFn: () => enforcementApi.list(params),
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: enforcementKeys.all });

  const sweepMutation = useMutation({
    mutationFn: () => enforcementApi.sweep(),
    onSuccess: (r) => {
      refresh();
      toast.success(
        r.casesOpened > 0
          ? `Compliance check complete. ${r.casesOpened} new case${r.casesOpened === 1 ? '' : 's'} opened.`
          : 'Compliance check complete. No new cases.',
      );
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't run the compliance check.")),
  });

  const actionMutation = useMutation({
    mutationFn: ({ id, kind, note: n }: { id: string; kind: 'resolve' | 'waive'; note: string }) =>
      kind === 'resolve' ? enforcementApi.resolve(id, n) : enforcementApi.waive(id, n),
    onSuccess: (_data, vars) => {
      refresh();
      setPending(null);
      setNote('');
      toast.success(vars.kind === 'resolve' ? 'Case resolved.' : 'Case waived.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't update the case.")),
  });

  const rows = listQuery.data?.data ?? [];

  const activeFilters: ActiveFilterChip[] = useMemo(() => {
    const chips: ActiveFilterChip[] = [];
    if (list.filters.status) {
      chips.push({
        key: 'status',
        label: ENFORCEMENT_STATUS_LABELS[list.filters.status as EnforcementStatus],
        onRemove: () => list.clearFilter('status'),
      });
    }
    if (list.filters.entityId) {
      chips.push({
        key: 'entityId',
        label: 'Entity',
        onRemove: () => list.clearFilter('entityId'),
      });
    }
    if (list.filters.periodId) {
      chips.push({
        key: 'periodId',
        label: 'Period',
        onRemove: () => list.clearFilter('periodId'),
      });
    }
    return chips;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.filters]);

  const columns: Column<EnforcementCase>[] = [
    {
      header: 'Entity',
      cell: (c) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-gray-900">{c.entity.name}</div>
          <div className="text-xs text-gray-500">{ENTITY_TYPE_LABELS[c.entity.type]}</div>
        </div>
      ),
    },
    {
      header: 'Period',
      cell: (c) => (
        <div className="min-w-0">
          <div className="truncate text-gray-700">{c.period.label}</div>
          <div className="text-xs text-gray-500">Due {formatDate(c.period.dueDate)}</div>
        </div>
      ),
    },
    {
      header: 'Reason',
      cell: (c) => <span className="text-gray-700">{ENFORCEMENT_REASON_LABELS[c.reason]}</span>,
    },
    {
      header: 'Status',
      sortKey: 'status',
      width: '9rem',
      cell: (c) => (
        <Badge tone={ENFORCEMENT_STATUS_TONE[c.status]}>
          {ENFORCEMENT_STATUS_LABELS[c.status]}
        </Badge>
      ),
    },
    {
      header: 'Opened',
      sortKey: 'openedAt',
      width: '9rem',
      cell: (c) => <span className="text-gray-600">{formatDate(c.openedAt)}</span>,
    },
    {
      header: 'Penalty',
      align: 'right',
      width: '10rem',
      cell: (c) =>
        c.penaltyAmount === null || c.penaltyAmount === undefined ? (
          <span className="text-gray-300">Not priced</span>
        ) : (
          <div className="min-w-0">
            <div className="tabular-nums font-medium text-gray-900">
              {formatSsp(Number(c.penaltyAmount))}
            </div>
            <div className="text-xs text-gray-500">
              {c.penaltyDays === 1 ? '1 day late' : `${c.penaltyDays ?? 0} days late`}
            </div>
          </div>
        ),
    },
    {
      header: 'Outcome',
      cell: (c) =>
        c.status === 'OPEN' ? (
          <span className="text-gray-300">—</span>
        ) : (
          <div className="min-w-0 text-xs text-gray-500">
            {c.resolvedBy && (
              <div className="truncate">{`${c.resolvedBy.firstName} ${c.resolvedBy.lastName}`}</div>
            )}
            {c.resolutionNote && <div className="truncate text-gray-500">{c.resolutionNote}</div>}
          </div>
        ),
    },
  ];

  if (canManage) {
    columns.push({
      header: '',
      width: '11rem',
      align: 'right',
      cell: (c) =>
        c.status === 'OPEN' ? (
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setNote('');
                setPending({ case: c, kind: 'resolve' });
              }}
            >
              Resolve
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setNote('');
                setPending({ case: c, kind: 'waive' });
              }}
            >
              Waive
            </Button>
          </div>
        ) : null,
    });
  }

  const description = isOperator
    ? 'Compliance cases raised against your entity when a return was not filed by the deadline.'
    : 'Compliance cases raised when an entity misses a reporting deadline. Resolve a case once the operator has filed, or waive it if no action is needed.';

  return (
    <ListShell
      header={<PageHeader description={description} />}
      filters={
        <>
          <FilterField label="Status" width="md">
            <Select
              aria-label="Filter by status"
              value={list.filters.status}
              options={STATUS_FILTER_OPTIONS}
              onChange={(status) => list.setFilters({ status })}
            />
          </FilterField>
          {!isOperator && (
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
              <FilterField label="Period" width="lg">
                <Combobox
                  aria-label="Filter by reporting period"
                  emptyLabel="All periods"
                  placeholder="Search periods…"
                  source={periodPicker}
                  value={list.filters.periodId}
                  onChange={(periodId) => list.setFilters({ periodId })}
                />
              </FilterField>
            </>
          )}
        </>
      }
      activeFilters={activeFilters}
      onClearFilters={list.clearAll}
      actions={
        canManage ? (
          <Button
            icon={ShieldAlert}
            variant="secondary"
            isLoading={sweepMutation.isPending}
            onClick={() => sweepMutation.mutate()}
          >
            Run compliance check
          </Button>
        ) : undefined
      }
      meta={listQuery.data?.meta}
      onPageChange={list.setPage}
      onPageSizeChange={list.setPageSize}
      refreshing={listQuery.isFetching && !listQuery.isLoading}
    >
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(c) => c.id}
        loading={listQuery.isLoading}
        refreshing={listQuery.isFetching && !listQuery.isLoading}
        error={listQuery.isError}
        onRetry={() => void listQuery.refetch()}
        sort={list.sort}
        order={list.order}
        onSortChange={list.setSort}
        emptyMessage={
          list.hasActiveFilters
            ? 'No compliance cases match these filters.'
            : 'No compliance cases. Everyone has filed on time.'
        }
      />

      <div className="mt-6">
        <PenaltySchedulePanel canManage={canManage} />
      </div>

      <Modal
        open={pending !== null}
        title={pending?.kind === 'waive' ? 'Waive this case?' : 'Resolve this case?'}
        onClose={() => setPending(null)}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            {pending?.kind === 'waive'
              ? `Waive the ${pending?.case.period.label} case for ${pending?.case.entity.name} without further action.`
              : `Mark the ${pending?.case.period.label} case for ${pending?.case.entity.name} resolved.`}
          </p>
          <Textarea
            rows={3}
            autoGrow
            placeholder="Add a note (optional)"
            aria-label="Note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setPending(null)}
              disabled={actionMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              isLoading={actionMutation.isPending}
              onClick={() =>
                pending && actionMutation.mutate({ id: pending.case.id, kind: pending.kind, note })
              }
            >
              {pending?.kind === 'waive' ? 'Waive case' : 'Resolve case'}
            </Button>
          </div>
        </div>
      </Modal>
    </ListShell>
  );
}
