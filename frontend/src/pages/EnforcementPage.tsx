import { useMemo, useState } from 'react';
import { strings } from '../lib/strings';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Combobox,
  DescriptionList,
  Drawer,
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
import { EnforcementOrders } from '../components/EnforcementOrders';
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
import { penaltyStanding } from '../lib/penalty-standing';
import { formatDate, formatSsp, joinMeta } from '../lib/format';
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

  const [open, setOpen] = useState<EnforcementCase | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const pendingStanding = pending ? penaltyStanding(pending.case) : null;
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
      width: '13rem',
      cell: (c) => <PenaltyCell case={c} />,
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
          <FilterField label={strings.field.status} width="md">
            <Select
              aria-label={strings.filter.byStatus}
              value={list.filters.status}
              options={STATUS_FILTER_OPTIONS}
              onChange={(status) => list.setFilters({ status })}
            />
          </FilterField>
          {!isOperator && (
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
              <FilterField label="Period" width="lg">
                <Combobox
                  aria-label="Filter by reporting period"
                  emptyLabel="All periods"
                  placeholder={strings.search.periods}
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
        onRowClick={setOpen}
        activeRowKey={open?.id}
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

      <Drawer
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open ? `${open.entity.name}: ${open.period.label}` : 'Compliance case'}
      >
        {open && <CaseDetail case={open} currentUserId={user?.id} canManage={canManage} />}
      </Drawer>

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
          {/*
            What is being given up, said before the button is pressed.
            Waiving an amount the operator already owes and waiving one that has not become payable
            yet are different acts, and the officer doing it should not have to work out which from
            a figure in a table they have already scrolled past.
          */}
          {pendingStanding && pendingStanding.kind !== 'not-priced' && pending && (
            <Alert tone={pendingStanding.kind === 'payable' ? 'warning' : 'info'}>
              {pendingStanding.kind === 'payable' ? (
                <>
                  {formatSsp(Number(pending.case.penaltyAmount))} is payable on this case.
                  {pending.kind === 'waive' ? ' Waiving it writes that amount off.' : ''}
                </>
              ) : pendingStanding.kind === 'accruing' ? (
                <>
                  {formatSsp(Number(pending.case.penaltyAmount))} has accrued but is not payable
                  yet. The operator has until {formatDate(pendingStanding.remedyEndsAt)} to file.
                </>
              ) : (
                <>This case is already closed.</>
              )}
            </Alert>
          )}
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
              {strings.action.cancel}
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

/**
 * A penalty figure, and whether the operator owes it yet.
 *
 * The amount on its own reads as a demand. Under the Act nothing is payable until thirty days'
 * notice has run, so for much of a case's life the figure is real, growing, and not owed — and the
 * screen said nothing to tell those two apart. The second line is the whole point of this
 * component; the number was already there.
 */
function PenaltyCell({ case: c }: { case: EnforcementCase }) {
  const standing = penaltyStanding(c);
  if (standing.kind === 'not-priced') return <span className="text-gray-300">Not priced</span>;

  const days = c.penaltyDays === 1 ? '1 day late' : `${c.penaltyDays ?? 0} days late`;

  return (
    <div className="min-w-0">
      <div
        className={`tabular-nums font-medium ${
          standing.kind === 'accruing' ? 'text-gray-600' : 'text-gray-900'
        }`}
      >
        {formatSsp(Number(c.penaltyAmount))}
      </div>
      {standing.kind === 'accruing' ? (
        <div className="text-xs text-warning-700">
          {/*
            The date, not only the count. "15 days left" is what an officer wants at a glance; the
            date is what goes in a letter, and a reader should not have to do the arithmetic.
          */}
          Not payable until {formatDate(standing.remedyEndsAt)}
          <span className="text-gray-500">
            {' '}
            ({standing.daysLeft === 1 ? '1 day left' : `${standing.daysLeft} days left`})
          </span>
        </div>
      ) : standing.kind === 'payable' ? (
        <div className="text-xs text-gray-500">{joinMeta(days, 'payable')}</div>
      ) : (
        <div className="text-xs text-gray-500">{days}</div>
      )}
    </div>
  );
}

/**
 * One compliance case, opened from the list.
 *
 * The case itself was always readable from the row; what needed a place to live is the formal
 * enforcement order, which is a different kind of thing from a penalty and does not belong in a
 * money column. A drawer rather than a page, because an officer working a list of cases is
 * comparing them, and sending them to a separate screen and back loses their place in the list.
 */
function CaseDetail({
  case: c,
  currentUserId,
  canManage,
}: {
  case: EnforcementCase;
  currentUserId: string | undefined;
  canManage: boolean;
}) {
  const standing = penaltyStanding(c);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={ENFORCEMENT_STATUS_TONE[c.status]}>
          {ENFORCEMENT_STATUS_LABELS[c.status]}
        </Badge>
        <span className="text-sm text-gray-500">{ENFORCEMENT_REASON_LABELS[c.reason]}</span>
      </div>

      <DescriptionList
        items={[
          { label: 'Operator', value: c.entity.name },
          { label: 'Period', value: c.period.label },
          { label: 'Filing deadline', value: formatDate(c.period.dueDate) },
          { label: 'Case opened', value: formatDate(c.openedAt) },
          {
            label: 'Default began',
            value: c.defaultStartedAt ? formatDate(c.defaultStartedAt) : null,
          },
          {
            label: 'Return arrived',
            value: c.defaultEndedAt ? formatDate(c.defaultEndedAt) : 'Still outstanding',
          },
        ]}
      />

      {standing.kind !== 'not-priced' && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Penalty</div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-gray-900">
            {formatSsp(Number(c.penaltyAmount))}
          </div>
          {/*
            The same distinction the list column draws, repeated here rather than assumed. This is
            the screen an officer reads before deciding what to do next, and an amount shown
            without saying whether it is owed yet is the one thing on this page with a legal
            consequence.
          */}
          <div className="mt-1 text-xs">
            {standing.kind === 'accruing' ? (
              <span className="text-warning-700">
                Accruing, not payable until {formatDate(standing.remedyEndsAt)}
              </span>
            ) : standing.kind === 'payable' ? (
              <span className="text-gray-600">Payable</span>
            ) : (
              <span className="text-gray-500">Frozen; the case is closed</span>
            )}
          </div>
          {c.penaltyRule?.label && (
            <div className="mt-2 text-xs text-gray-500">Priced under {c.penaltyRule.label}</div>
          )}
        </div>
      )}

      {c.note && (
        <div>
          <h4 className="text-sm font-medium text-gray-900">Why the case was opened</h4>
          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600">{c.note}</p>
        </div>
      )}

      {c.resolutionNote && (
        <div>
          <h4 className="text-sm font-medium text-gray-900">Outcome</h4>
          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600">{c.resolutionNote}</p>
        </div>
      )}

      <EnforcementOrders case={c} currentUserId={currentUserId} canManage={canManage} />
    </div>
  );
}
