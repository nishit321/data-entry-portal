import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, Download, ScrollText } from 'lucide-react';
import {
  Badge,
  Button,
  Combobox,
  FilterField,
  DateRangeFilter,
  DescriptionList,
  Drawer,
  ListShell,
  PageHeader,
  RelativeTime,
  Select,
  useToast,
  type ActiveFilterChip,
  type SelectOption,
} from '../components/ui';
import { DataTable, type Column, type Density } from '../components/DataTable';
import { auditApi, auditKeys, type AuditListParams } from '../lib/audit.api';
import { useListParams } from '../hooks/useListParams';
import { userPicker } from '../lib/pickers';
import { collectForExport, downloadCsv, exportFilename, toCsv } from '../lib/csv';
import { describeDevice, formatDateTime, humaniseKey } from '../lib/format';
import { getErrorMessage } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_LABELS,
  ROLE_LABELS,
  type AuditAction,
  type AuditLogRow,
  type Tone,
} from '../lib/types';

const ACTION_FILTER_OPTIONS: SelectOption[] = [
  { value: '', label: 'All actions' },
  ...AUDIT_ACTIONS.map((a) => ({ value: a, label: AUDIT_ACTION_LABELS[a] })),
];

// The entity types the trail records (the model names passed to AuditService).
const ENTITY_TYPE_FILTER_OPTIONS: SelectOption[] = [
  { value: '', label: 'All types' },
  { value: 'User', label: 'User' },
  { value: 'Entity', label: 'Entity' },
  { value: 'Agent', label: 'Agent' },
  { value: 'ReportingTemplate', label: 'Template' },
  { value: 'ReportingPeriod', label: 'Reporting period' },
  { value: 'Submission', label: 'Submission' },
  { value: 'ReferenceItem', label: 'Reference item' },
  { value: 'DocumentRecord', label: 'Document' },
  { value: 'EnforcementCase', label: 'Compliance case' },
  { value: 'Complaint', label: 'Complaint' },
  { value: 'LevyRate', label: 'Levy rate' },
];

const ENTITY_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  ENTITY_TYPE_FILTER_OPTIONS.filter((o) => o.value).map((o) => [o.value, o.label]),
);

/** A failed, deleted, or locked action reads as more serious, so it carries a stronger tone. */
function actionTone(action: AuditAction): Tone {
  if (action.endsWith('_FAILED') || action.endsWith('_DELETED') || action === 'USER_LOCKED') {
    return 'danger';
  }
  if (action === 'USER_DEACTIVATED') return 'warning';
  return 'gray';
}

function actorName(row: AuditLogRow): string {
  return row.actor ? `${row.actor.firstName} ${row.actor.lastName}` : 'System';
}

export function AuditLogPage() {
  const { user } = useAuth();
  const toast = useToast();
  // The users list is Admin-only, so the actor picker is offered to Admins; other
  // Authority roles still get the action, entity-type, and date filters.
  const isAdmin = user?.role === 'ADMIN';

  const list = useListParams({
    defaultSort: 'createdAt',
    defaultOrder: 'desc',
    preferenceKey: 'audit',
    filters: { action: '', entityType: '', actorId: '', from: '', to: '' },
  });

  const [density, setDensity] = useState<Density>('comfortable');
  const [openRecord, setOpenRecord] = useState<AuditLogRow | null>(null);

  const params: AuditListParams = {
    page: list.page,
    pageSize: list.pageSize,
    sort: list.sort as AuditListParams['sort'],
    order: list.order,
    action: (list.filters.action || undefined) as AuditAction | undefined,
    entityType: list.filters.entityType || undefined,
    actorId: isAdmin ? list.filters.actorId || undefined : undefined,
    from: list.filters.from || undefined,
    to: list.filters.to || undefined,
  };

  const listQuery = useQuery({
    queryKey: auditKeys.list(params),
    queryFn: () => auditApi.list(params),
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      const { rows: all, truncated } = await collectForExport<AuditLogRow>((page, pageSize) =>
        auditApi.list({ ...params, page, pageSize }),
      );
      downloadCsv(
        exportFilename('audit-log'),
        toCsv(all, [
          { header: 'When', value: (r) => formatDateTime(r.createdAt) },
          { header: 'Actor', value: (r) => actorName(r) },
          { header: 'Actor email', value: (r) => r.actor?.email ?? '' },
          { header: 'Actor role', value: (r) => (r.actor ? ROLE_LABELS[r.actor.role] : '') },
          { header: 'Action', value: (r) => AUDIT_ACTION_LABELS[r.action] ?? r.action },
          {
            header: 'Record type',
            value: (r) => (r.entityType ? (ENTITY_TYPE_LABEL[r.entityType] ?? r.entityType) : ''),
          },
          { header: 'Record', value: (r) => r.target ?? '' },
          { header: 'Record id', value: (r) => r.entityId ?? '' },
          { header: 'IP address', value: (r) => r.ipAddress ?? '' },
          { header: 'Request id', value: (r) => r.requestId ?? '' },
        ]),
      );
      return { count: all.length, truncated };
    },
    onSuccess: ({ count, truncated }) =>
      truncated
        ? toast.warning(
            `Exported the first ${count.toLocaleString()} records. Narrow the filters to get the rest.`,
          )
        : toast.success(`Exported ${count.toLocaleString()} records.`),
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't build the export")),
  });

  const rows = listQuery.data?.data ?? [];

  const activeFilters: ActiveFilterChip[] = useMemo(() => {
    const chips: ActiveFilterChip[] = [];
    if (list.filters.action) {
      chips.push({
        key: 'action',
        label: AUDIT_ACTION_LABELS[list.filters.action as AuditAction] ?? list.filters.action,
        onRemove: () => list.clearFilter('action'),
      });
    }
    if (list.filters.entityType) {
      chips.push({
        key: 'entityType',
        label: ENTITY_TYPE_LABEL[list.filters.entityType] ?? list.filters.entityType,
        onRemove: () => list.clearFilter('entityType'),
      });
    }
    if (list.filters.actorId) {
      chips.push({
        key: 'actorId',
        label: 'One actor',
        onRemove: () => list.clearFilter('actorId'),
      });
    }
    if (list.filters.from || list.filters.to) {
      chips.push({
        key: 'dates',
        label: `${list.filters.from || 'Any date'} to ${list.filters.to || 'now'}`,
        onRemove: () => list.setFilters({ from: '', to: '' }),
      });
    }
    return chips;
  }, [list]);

  const columns: Column<AuditLogRow>[] = [
    {
      header: 'When',
      sortKey: 'createdAt',
      width: '11rem',
      cell: (r) => <RelativeTime value={r.createdAt} className="text-gray-700" />,
    },
    {
      header: 'Actor',
      width: '18rem',
      cell: (r) =>
        r.actor ? (
          <div className="min-w-0">
            <div className="truncate font-medium text-gray-900">{actorName(r)}</div>
            <div className="truncate text-xs text-gray-500">{r.actor.email}</div>
          </div>
        ) : (
          <span className="text-gray-500">System</span>
        ),
    },
    {
      header: 'Action',
      sortKey: 'action',
      width: '14rem',
      cell: (r) => (
        <Badge tone={actionTone(r.action)}>{AUDIT_ACTION_LABELS[r.action] ?? r.action}</Badge>
      ),
    },
    {
      header: 'Record',
      cell: (r) =>
        r.entityType ? (
          <div className="min-w-0">
            <div className="truncate text-gray-700">
              {r.target ?? ENTITY_TYPE_LABEL[r.entityType] ?? '—'}
            </div>
            <div className="truncate text-xs text-gray-500">
              {ENTITY_TYPE_LABEL[r.entityType] ?? r.entityType}
            </div>
          </div>
        ) : (
          <span className="text-gray-300">—</span>
        ),
    },
  ];

  return (
    <ListShell
      header={
        <PageHeader description="Every recorded action across the portal: who did what, to which record, and when. The trail is append-only and cannot be edited." />
      }
      filters={
        <>
          <FilterField label="Action" width="lg">
            <Select
              aria-label="Filter by action"
              value={list.filters.action}
              options={ACTION_FILTER_OPTIONS}
              onChange={(action) => list.setFilters({ action })}
            />
          </FilterField>
          <FilterField label="Record type" width="md">
            <Select
              aria-label="Filter by record type"
              value={list.filters.entityType}
              options={ENTITY_TYPE_FILTER_OPTIONS}
              onChange={(entityType) => list.setFilters({ entityType })}
            />
          </FilterField>
          {isAdmin && (
            <FilterField label="Actor" width="xl">
              <Combobox
                aria-label="Filter by actor"
                emptyLabel="All actors"
                placeholder="Search people…"
                source={userPicker}
                value={list.filters.actorId}
                onChange={(actorId) => list.setFilters({ actorId })}
              />
            </FilterField>
          )}
          <DateRangeFilter
            label="Period"
            value={{ from: list.filters.from, to: list.filters.to }}
            onChange={(range) => list.setFilters({ from: range.from, to: range.to })}
          />
        </>
      }
      activeFilters={activeFilters}
      onClearFilters={list.clearAll}
      actions={
        <Button
          variant="secondary"
          icon={Download}
          isLoading={exportMutation.isPending}
          onClick={() => exportMutation.mutate()}
          disabled={rows.length === 0}
        >
          Export
        </Button>
      }
      meta={listQuery.data?.meta}
      onPageChange={list.setPage}
      onPageSizeChange={list.setPageSize}
      refreshing={listQuery.isFetching && !listQuery.isLoading}
      onDensityChange={setDensity}
      footnote={
        <p className="flex items-center gap-1.5 text-xs text-gray-500">
          <ScrollText size={13} aria-hidden /> Records are kept for the retention period and never
          changed after they are written.
        </p>
      }
    >
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={listQuery.isLoading}
        refreshing={listQuery.isFetching && !listQuery.isLoading}
        error={listQuery.isError}
        onRetry={() => void listQuery.refetch()}
        sort={list.sort}
        order={list.order}
        onSortChange={list.setSort}
        density={density}
        onRowClick={setOpenRecord}
        activeRowKey={openRecord?.id}
        emptyMessage={
          list.hasActiveFilters ? 'No audit records match these filters.' : 'No audit records yet.'
        }
      />

      <AuditRecordDrawer record={openRecord} onClose={() => setOpenRecord(null)} />
    </ListShell>
  );
}

/** The shapes a backend commonly uses to record "this became that". */
const CHANGE_SHAPES: [string, string][] = [
  ['from', 'to'],
  ['before', 'after'],
  ['old', 'new'],
  ['previous', 'current'],
];

function asText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length === 0 ? '—' : value.map(asText).join(', ');
  return String(value);
}

/**
 * One recorded detail, rendered for a reader rather than for a developer.
 *
 * A `JSON.stringify` block is the honest representation of a value and the wrong one for this
 * audience: the Authority reads this trail to answer "what did this person change", and a braces-
 * and-quotes dump makes them parse the storage format first. A before/after pair — the commonest
 * thing in the metadata — reads as an arrow, which is the sentence they were going to say anyway.
 */
function MetadataValue({ value }: { value: unknown }) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;

    const change = CHANGE_SHAPES.find(([a, b]) => a in record && b in record);
    if (change) {
      const [fromKey, toKey] = change;
      return (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span className="text-gray-500 line-through">{asText(record[fromKey])}</span>
          <ArrowRight size={13} className="shrink-0 text-gray-300" aria-hidden />
          <span className="sr-only">changed to</span>
          <span className="font-medium text-gray-900">{asText(record[toKey])}</span>
        </span>
      );
    }

    // A nested object gets one level of the same treatment rather than a code block.
    return (
      <ul className="space-y-0.5">
        {Object.entries(record).map(([k, v]) => (
          <li key={k}>
            <span className="text-gray-500">{humaniseKey(k)}: </span>
            {asText(v)}
          </li>
        ))}
      </ul>
    );
  }

  return <>{asText(value)}</>;
}

/**
 * The full record behind a row (FRONTEND_STANDARDS §3.11).
 *
 * The table can only ever show four or five columns, but the trail stores much more — the request
 * id, the address the action came from, and the `metadata` describing what actually changed. That
 * is the point of an audit log, and none of it was reachable from the UI at all. A drawer keeps
 * the user's place in the list, which matters when they're working through a filtered set.
 */
function AuditRecordDrawer({
  record,
  onClose,
}: {
  record: AuditLogRow | null;
  onClose: () => void;
}) {
  if (!record) return null;

  const metadata =
    record.metadata && typeof record.metadata === 'object'
      ? (record.metadata as Record<string, unknown>)
      : null;

  return (
    <Drawer
      open
      onClose={onClose}
      title={AUDIT_ACTION_LABELS[record.action] ?? record.action}
      description={formatDateTime(record.createdAt)}
      width="lg"
    >
      <div className="space-y-6">
        {/*
          What an audit reader needs: who acted, on what, when, and — for anything that looks
          wrong — where from. The record's own database id, the raw user-agent header, and the
          field keys underneath the data are developer output; they told the reader nothing and
          they leaked the schema's vocabulary into a screen the Authority reads (§10). The
          identifiers still travel in the CSV export, which is where machine-readable belongs.
        */}
        <DescriptionList
          items={[
            { label: 'Action', value: AUDIT_ACTION_LABELS[record.action] ?? record.action },
            { label: 'When', value: formatDateTime(record.createdAt) },
            { label: 'Actor', value: actorName(record) },
            { label: 'Actor email', value: record.actor?.email ?? null },
            { label: 'Actor role', value: record.actor ? ROLE_LABELS[record.actor.role] : null },
            {
              label: 'Record type',
              value: record.entityType
                ? (ENTITY_TYPE_LABEL[record.entityType] ?? record.entityType)
                : null,
            },
            { label: 'Record', value: record.target ?? null },
            // Kept: the two fields an investigator actually uses. An audit trail exists to answer
            // "was this really them, from where" — dropping these would gut it.
            { label: 'Signed in from', value: record.ipAddress ?? null },
            { label: 'Device', value: describeDevice(record.userAgent) },
          ]}
        />

        {metadata && Object.keys(metadata).length > 0 && (
          <section>
            <h3 className="text-sm font-semibold text-gray-900">What changed</h3>
            <p className="mt-0.5 text-xs text-gray-500">The details recorded with this action.</p>
            <dl className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-200">
              {Object.entries(metadata).map(([key, value]) => (
                <div key={key} className="grid grid-cols-3 gap-3 px-3 py-2 text-sm">
                  <dt className="font-medium text-gray-500">{humaniseKey(key)}</dt>
                  <dd className="col-span-2 break-words text-gray-800">
                    <MetadataValue value={value} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {record.requestId && (
          <p className="text-xs text-gray-500">
            If you need to raise this entry with the portal team, quote{' '}
            <span className="font-mono">{record.requestId}</span>.
          </p>
        )}
      </div>
    </Drawer>
  );
}
