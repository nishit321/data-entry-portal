import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquareWarning } from 'lucide-react';
import {
  Badge,
  Button,
  Combobox,
  DescriptionList,
  Drawer,
  Field,
  FilterField,
  ListShell,
  PageHeader,
  Select,
  Textarea,
  useToast,
  type ActiveFilterChip,
  type SelectOption,
} from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import { complaintsApi, complaintKeys, type ComplaintListParams } from '../lib/complaints.api';
import { useListParams } from '../hooks/useListParams';
import { entityPicker } from '../lib/pickers';
import { getErrorMessage } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { COMPLAINT_STATUS_TONE } from '../lib/status';
import { formatDate, formatDateTime, joinMeta } from '../lib/format';
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_CATEGORY_LABELS,
  COMPLAINT_STATUS_LABELS,
  COMPLAINT_STATUSES,
  type Complaint,
  type ComplaintCategory,
  type ComplaintStatus,
} from '../lib/types';

const STATUS_FILTER_OPTIONS: SelectOption[] = [
  { value: '', label: 'All statuses' },
  ...COMPLAINT_STATUSES.map((s) => ({ value: s, label: COMPLAINT_STATUS_LABELS[s] })),
];
const CATEGORY_FILTER_OPTIONS: SelectOption[] = [
  { value: '', label: 'All categories' },
  ...COMPLAINT_CATEGORIES.map((c) => ({ value: c, label: COMPLAINT_CATEGORY_LABELS[c] })),
];
const STATUS_OPTIONS: SelectOption[] = COMPLAINT_STATUSES.map((s) => ({
  value: s,
  label: COMPLAINT_STATUS_LABELS[s],
}));

export function ComplaintsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  // Analysts can read the case book; only ADMIN and SUPERVISOR move a case along.
  const canHandle = user?.role === 'ADMIN' || user?.role === 'SUPERVISOR';

  const list = useListParams({
    defaultSort: 'createdAt',
    defaultOrder: 'desc',
    preferenceKey: 'complaints',
    filters: { status: '', category: '', aboutEntityId: '' },
  });

  const params: ComplaintListParams = {
    page: list.page,
    pageSize: list.pageSize,
    sort: list.sort as ComplaintListParams['sort'],
    order: list.order,
    status: (list.filters.status || undefined) as ComplaintStatus | undefined,
    category: (list.filters.category || undefined) as ComplaintCategory | undefined,
    aboutEntityId: list.filters.aboutEntityId || undefined,
    search: list.search || undefined,
  };

  const listQuery = useQuery({
    queryKey: complaintKeys.list(params),
    queryFn: () => complaintsApi.list(params),
  });

  const [open, setOpen] = useState<Complaint | null>(null);
  const [status, setStatus] = useState<ComplaintStatus>('IN_REVIEW');
  const [note, setNote] = useState('');

  const openCase = (c: Complaint) => {
    setOpen(c);
    setStatus(c.status);
    setNote(c.resolutionNote ?? '');
  };

  const updateMutation = useMutation({
    mutationFn: () => complaintsApi.updateStatus(open!.id, status, note.trim() || undefined),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: complaintKeys.all });
      setOpen(updated);
      toast.success('Case updated.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't update the case.")),
  });

  const rows = listQuery.data?.data ?? [];

  const activeFilters: ActiveFilterChip[] = useMemo(() => {
    const chips: ActiveFilterChip[] = [];
    if (list.filters.status) {
      chips.push({
        key: 'status',
        label: COMPLAINT_STATUS_LABELS[list.filters.status as ComplaintStatus],
        onRemove: () => list.clearFilter('status'),
      });
    }
    if (list.filters.category) {
      chips.push({
        key: 'category',
        label: COMPLAINT_CATEGORY_LABELS[list.filters.category as ComplaintCategory],
        onRemove: () => list.clearFilter('category'),
      });
    }
    if (list.filters.aboutEntityId) {
      chips.push({
        key: 'aboutEntityId',
        label: 'Operator',
        onRemove: () => list.clearFilter('aboutEntityId'),
      });
    }
    return chips;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.filters]);

  const columns: Column<Complaint>[] = [
    {
      header: 'Reference',
      width: '13rem',
      cell: (c) => (
        <div className="min-w-0">
          <div className="truncate font-mono text-xs text-gray-700">{c.referenceNumber}</div>
          <div className="text-xs text-gray-500">{formatDate(c.createdAt)}</div>
        </div>
      ),
    },
    {
      header: 'Subject',
      cell: (c) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-gray-900">{c.subject}</div>
          <div className="truncate text-xs text-gray-500">
            {joinMeta(COMPLAINT_CATEGORY_LABELS[c.category], c.aboutEntity?.name)}
          </div>
        </div>
      ),
    },
    {
      header: 'From',
      width: '12rem',
      cell: (c) =>
        c.complainantName || c.complainantEmail ? (
          <div className="min-w-0 text-xs text-gray-600">
            <div className="truncate">{c.complainantName ?? 'Not given'}</div>
            <div className="truncate text-gray-500">{c.complainantEmail}</div>
          </div>
        ) : (
          <span className="text-xs text-gray-500">Anonymous</span>
        ),
    },
    {
      header: 'Status',
      sortKey: 'status',
      width: '9rem',
      cell: (c) => (
        <Badge tone={COMPLAINT_STATUS_TONE[c.status]}>{COMPLAINT_STATUS_LABELS[c.status]}</Badge>
      ),
    },
  ];

  return (
    <ListShell
      header={
        <PageHeader description="Complaints and suggestions filed by the public. Open a case to see the full report and record what was done." />
      }
      search={{
        value: list.search,
        onChange: list.setSearch,
        placeholder: 'Search by reference or subject',
        label: 'Search complaints',
      }}
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
          <FilterField label="Category" width="md">
            <Select
              aria-label="Filter by category"
              value={list.filters.category}
              options={CATEGORY_FILTER_OPTIONS}
              onChange={(category) => list.setFilters({ category })}
            />
          </FilterField>
          <FilterField label="Operator" width="lg">
            <Combobox
              aria-label="Filter by operator"
              emptyLabel="Any operator"
              placeholder="Search operators…"
              source={entityPicker}
              value={list.filters.aboutEntityId}
              onChange={(aboutEntityId) => list.setFilters({ aboutEntityId })}
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
        onRowClick={openCase}
        activeRowKey={open?.id}
        emptyMessage={
          list.hasActiveFilters
            ? 'No complaints match these filters.'
            : 'No complaints have been filed yet.'
        }
      />

      <Drawer
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open?.subject ?? 'Complaint'}
      >
        {open && (
          <div className="space-y-5">
            <div className="flex items-center gap-2">
              <Badge tone={COMPLAINT_STATUS_TONE[open.status]}>
                {COMPLAINT_STATUS_LABELS[open.status]}
              </Badge>
              <span className="font-mono text-xs text-gray-500">{open.referenceNumber}</span>
            </div>

            <DescriptionList
              items={[
                { label: 'Category', value: COMPLAINT_CATEGORY_LABELS[open.category] },
                { label: 'About', value: open.aboutEntity?.name ?? 'No operator named' },
                { label: 'Filed', value: formatDateTime(open.createdAt) },
                {
                  label: 'Closed',
                  value: open.resolvedAt ? formatDateTime(open.resolvedAt) : null,
                },
                { label: 'Name', value: open.complainantName ?? 'Filed anonymously', full: true },
                { label: 'Email', value: open.complainantEmail },
                { label: 'Phone', value: open.complainantPhone },
                {
                  label: 'Handled by',
                  value: open.handledBy
                    ? `${open.handledBy.firstName} ${open.handledBy.lastName}`
                    : null,
                  full: true,
                },
              ]}
            />

            <div>
              <h4 className="text-sm font-medium text-gray-900">What was reported</h4>
              <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600">{open.description}</p>
            </div>

            {canHandle ? (
              <div className="space-y-3 border-t border-gray-100 pt-4">
                <h4 className="text-sm font-medium text-gray-900">Record what was done</h4>
                <Field label="Status" htmlFor="cmp-status">
                  <Select
                    id="cmp-status"
                    value={status}
                    options={STATUS_OPTIONS}
                    onChange={(v) => setStatus(v as ComplaintStatus)}
                  />
                </Field>
                <Field
                  label="Note"
                  htmlFor="cmp-note"
                  hint="Shared with the citizen when they check on their complaint."
                >
                  <Textarea
                    id="cmp-note"
                    rows={3}
                    autoGrow
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </Field>
                <div className="flex justify-end">
                  <Button
                    icon={MessageSquareWarning}
                    isLoading={updateMutation.isPending}
                    onClick={() => updateMutation.mutate()}
                  >
                    Save the case
                  </Button>
                </div>
              </div>
            ) : (
              open.resolutionNote && (
                <div className="border-t border-gray-100 pt-4">
                  <h4 className="text-sm font-medium text-gray-900">Outcome</h4>
                  <p className="mt-1 text-sm text-gray-600">{open.resolutionNote}</p>
                </div>
              )
            )}
          </div>
        )}
      </Drawer>
    </ListShell>
  );
}
