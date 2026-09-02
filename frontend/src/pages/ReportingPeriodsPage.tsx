import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Lock, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Combobox,
  FilterField,
  ConfirmDialog,
  DatePicker,
  FormField,
  IconButton,
  Input,
  ListShell,
  Modal,
  PageHeader,
  Select,
  useToast,
  type ActiveFilterChip,
  type SelectOption,
} from '../components/ui';
import { DataTable, type Column, type Density } from '../components/DataTable';
import { useListParams } from '../hooks/useListParams';
import {
  periodsApi,
  periodKeys,
  type PeriodInput,
  type PeriodListParams,
} from '../lib/reporting-periods.api';
import { templatesApi } from '../lib/templates.api';
import { publishedTemplatePicker } from '../lib/pickers';
import { getErrorMessage } from '../lib/api';
import { PERIOD_STATUS_TONE, PERIOD_PHASE_TONE } from '../lib/status';
import { formatDate, toDateInputValue } from '../lib/format';
import {
  PERIOD_FREQUENCIES,
  PERIOD_STATUSES,
  PERIOD_STATUS_LABELS,
  PERIOD_PHASE_LABELS,
  REPORTING_FREQUENCY_LABELS,
  type ReportingPeriod,
} from '../lib/types';

const FREQUENCY_OPTIONS: SelectOption[] = PERIOD_FREQUENCIES.map((f) => ({
  value: f,
  label: REPORTING_FREQUENCY_LABELS[f],
}));
const STATUS_OPTIONS: SelectOption[] = PERIOD_STATUSES.map((s) => ({
  value: s,
  label: PERIOD_STATUS_LABELS[s],
}));
const FREQUENCY_FILTER_OPTIONS: SelectOption[] = [
  { value: '', label: 'All frequencies' },
  ...FREQUENCY_OPTIONS,
];
const STATUS_FILTER_OPTIONS: SelectOption[] = [
  { value: '', label: 'All statuses' },
  ...STATUS_OPTIONS,
];
// On create, a period may only start Open or be Scheduled for later — never Closed.
const CREATE_STATUS_OPTIONS: SelectOption[] = [
  { value: 'OPEN', label: 'Open' },
  { value: 'SCHEDULED', label: 'Scheduled' },
];

const periodSchema = z
  .object({
    templateId: z.string().min(1, 'Select a template'),
    frequency: z.enum(PERIOD_FREQUENCIES),
    label: z.string().min(1, 'Label is required').max(100),
    periodStart: z.string().min(1, 'Start date is required'),
    periodEnd: z.string().min(1, 'End date is required'),
    dueDate: z.string().min(1, 'Due date is required'),
    graceDays: z.preprocess(
      (v) => (v === '' || v == null ? undefined : Number(v)),
      z.number({ invalid_type_error: 'Enter a number' }).int().min(0).max(60),
    ),
    status: z.enum(['OPEN', 'SCHEDULED']),
  })
  // Backend enforces start ≤ end ≤ due (400 otherwise); mirror it so the operator
  // sees the problem inline. ISO yyyy-mm-dd strings compare correctly lexically.
  .superRefine((v, ctx) => {
    if (v.periodStart && v.periodEnd && v.periodStart > v.periodEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['periodEnd'],
        message: 'End date must be on or after the start date',
      });
    }
    if (v.periodEnd && v.dueDate && v.periodEnd > v.dueDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dueDate'],
        message: 'Due date must be on or after the end date',
      });
    }
  });

type PeriodForm = z.infer<typeof periodSchema>;

export function ReportingPeriodsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useListParams({
    defaultSort: 'dueDate',
    defaultOrder: 'asc',
    preferenceKey: 'reporting-periods',
    filters: { status: '', frequency: '' },
  });
  const [density, setDensity] = useState<Density>('comfortable');

  const params: PeriodListParams = {
    page: list.page,
    pageSize: list.pageSize,
    sort: list.sort as PeriodListParams['sort'],
    order: list.order,
    search: list.search || undefined,
    status: (list.filters.status || undefined) as PeriodListParams['status'],
    frequency: (list.filters.frequency || undefined) as PeriodListParams['frequency'],
  };
  const [editing, setEditing] = useState<ReportingPeriod | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [confirming, setConfirming] = useState<ReportingPeriod | null>(null);
  const [error, setError] = useState('');

  const listQuery = useQuery({
    queryKey: periodKeys.list(params),
    queryFn: () => periodsApi.list(params),
  });

  // Periods bind to a published template. The picker itself searches server-side
  // (`publishedTemplatePicker`), so this one-row query only answers "is there anything to pick at
  // all" — which lets the form say so up front instead of offering an empty dropdown.
  const templatesQuery = useQuery({
    queryKey: ['templates', 'published-any'],
    queryFn: () => templatesApi.list({ status: 'PUBLISHED', page: 1, pageSize: 1 }),
    enabled: formOpen && !editing,
  });
  const noTemplates = !editing && templatesQuery.isSuccess && templatesQuery.data.meta.total === 0;

  const activeFilters: ActiveFilterChip[] = [
    ...(list.search
      ? [{ key: 'search', label: 'Matching ' + list.search, onRemove: () => list.setSearch('') }]
      : []),
    ...(list.filters.status
      ? [
          {
            key: 'status',
            label:
              STATUS_FILTER_OPTIONS.find((o) => o.value === list.filters.status)?.label ??
              list.filters.status,
            onRemove: () => list.clearFilter('status'),
          },
        ]
      : []),
    ...(list.filters.frequency
      ? [
          {
            key: 'frequency',
            label:
              FREQUENCY_FILTER_OPTIONS.find((o) => o.value === list.filters.frequency)?.label ??
              list.filters.frequency,
            onRemove: () => list.clearFilter('frequency'),
          },
        ]
      : []),
  ];

  const form = useForm<PeriodForm>({ resolver: zodResolver(periodSchema) });
  const { errors } = form.formState;

  const openCreate = () => {
    setEditing(null);
    form.reset({
      templateId: '',
      frequency: 'MONTHLY',
      label: '',
      periodStart: '',
      periodEnd: '',
      dueDate: '',
      graceDays: 5,
      status: 'OPEN',
    });
    setError('');
    setFormOpen(true);
  };

  const openEdit = (period: ReportingPeriod) => {
    setEditing(period);
    form.reset({
      templateId: period.templateId,
      // Frequency is a subset of ReportingFrequency; a persisted period is always
      // one of the single-cycle values, so this narrowing is safe.
      frequency: period.frequency as PeriodForm['frequency'],
      label: period.label,
      periodStart: toDateInputValue(period.periodStart),
      periodEnd: toDateInputValue(period.periodEnd),
      dueDate: toDateInputValue(period.dueDate),
      graceDays: period.graceDays,
      status: period.status === 'CLOSED' ? 'SCHEDULED' : period.status,
    });
    setError('');
    setFormOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: (v: PeriodForm) => {
      if (editing) {
        // Only label, dates, and grace are editable — template/frequency/status
        // are immutable after creation (status changes go through open/close).
        return periodsApi.update(editing.id, {
          label: v.label,
          periodStart: v.periodStart,
          periodEnd: v.periodEnd,
          dueDate: v.dueDate,
          graceDays: v.graceDays,
        });
      }
      const body: PeriodInput = {
        templateId: v.templateId,
        frequency: v.frequency,
        label: v.label,
        periodStart: v.periodStart,
        periodEnd: v.periodEnd,
        dueDate: v.dueDate,
        graceDays: v.graceDays,
        status: v.status,
      };
      return periodsApi.create(body);
    },
    onSuccess: (period) => {
      qc.invalidateQueries({ queryKey: periodKeys.all });
      setFormOpen(false);
      setError('');
      toast.success(`Period "${period.label}" ${editing ? 'updated' : 'opened'}.`);
    },
    onError: (err) => setError(getErrorMessage(err, "We couldn't save the period")),
  });

  const openMutation = useMutation({
    mutationFn: (id: string) => periodsApi.open(id),
    onSuccess: (period) => {
      qc.invalidateQueries({ queryKey: periodKeys.all });
      toast.success(`Period "${period.label}" opened.`);
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't open the period")),
  });

  const closeMutation = useMutation({
    mutationFn: (id: string) => periodsApi.close(id),
    onSuccess: (period) => {
      qc.invalidateQueries({ queryKey: periodKeys.all });
      toast.success(`Period "${period.label}" closed.`);
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't close the period")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => periodsApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: periodKeys.all });
      setConfirming(null);
      toast.success('Period deleted.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't delete the period")),
  });

  const rows = listQuery.data?.data ?? [];

  const columns: Column<ReportingPeriod>[] = [
    {
      header: 'Template',
      cell: (p) => (
        <span className="font-medium text-gray-900">
          {p.template.name} <span className="text-gray-500">v{p.template.version}</span>
        </span>
      ),
    },
    {
      header: 'Frequency',
      sortKey: 'frequency',
      cell: (p) => <span className="text-gray-600">{REPORTING_FREQUENCY_LABELS[p.frequency]}</span>,
    },
    {
      header: 'Period',
      sortKey: 'periodStart',
      cell: (p) => (
        <span className="text-gray-600">
          {formatDate(p.periodStart)} to {formatDate(p.periodEnd)}
        </span>
      ),
    },
    {
      header: 'Due',
      sortKey: 'dueDate',
      cell: (p) => <span className="text-gray-600">{formatDate(p.dueDate)}</span>,
    },
    {
      header: 'Phase',
      cell: (p) => (
        <Badge tone={PERIOD_PHASE_TONE[p.timeline.phase]}>
          {PERIOD_PHASE_LABELS[p.timeline.phase]}
        </Badge>
      ),
    },
    {
      header: 'Status',
      sortKey: 'status',
      cell: (p) => (
        <Badge tone={PERIOD_STATUS_TONE[p.status]}>{PERIOD_STATUS_LABELS[p.status]}</Badge>
      ),
    },
    {
      header: 'Actions',
      align: 'right',
      cell: (p) => (
        <div className="flex justify-end gap-1">
          {p.status !== 'OPEN' && (
            <IconButton
              icon={Play}
              label="Open this period for filing"
              onClick={() => openMutation.mutate(p.id)}
            />
          )}
          {p.status !== 'CLOSED' && (
            <IconButton
              icon={Lock}
              label="Close this period"
              onClick={() => closeMutation.mutate(p.id)}
            />
          )}
          <IconButton icon={Pencil} label="Edit this period" onClick={() => openEdit(p)} />
          <IconButton
            icon={Trash2}
            label="Delete this period"
            variant="danger"
            onClick={() => setConfirming(p)}
          />
        </div>
      ),
    },
  ];

  return (
    <ListShell
      header={
        <PageHeader
          description="Open and track the reporting periods operators submit against, with live deadline status."
          actions={
            <Button onClick={openCreate} icon={Plus}>
              Open a period
            </Button>
          }
        />
      }
      search={{
        value: list.search,
        onChange: list.setSearch,
        placeholder: 'Search by label',
        label: 'Search periods',
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
          <FilterField label="Frequency" width="lg">
            <Select
              aria-label="Filter by frequency"
              value={list.filters.frequency}
              options={FREQUENCY_FILTER_OPTIONS}
              onChange={(frequency) => list.setFilters({ frequency })}
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
      footnote={
        <p className="flex items-center gap-1.5 text-xs text-gray-500">
          <CalendarClock size={13} aria-hidden /> Phase is based on the due date and grace window.
          It&apos;s the live signal that shows whether operators are on time.
        </p>
      }
    >
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(p) => p.id}
        loading={listQuery.isLoading}
        refreshing={listQuery.isFetching && !listQuery.isLoading}
        error={listQuery.isError}
        onRetry={() => void listQuery.refetch()}
        sort={list.sort}
        order={list.order}
        onSortChange={list.setSort}
        density={density}
        emptyMessage={
          list.hasActiveFilters
            ? 'No reporting periods match your filters.'
            : 'No reporting periods have been opened yet.'
        }
        emptyAction={
          list.hasActiveFilters ? (
            <Button variant="secondary" onClick={list.clearAll}>
              Clear filters
            </Button>
          ) : (
            <Button variant="secondary" onClick={openCreate}>
              Open the first period
            </Button>
          )
        }
      />

      <Modal
        open={formOpen}
        title={editing ? 'Edit reporting period' : 'Open a reporting period'}
        onClose={() => setFormOpen(false)}
      >
        {noTemplates ? (
          <div className="space-y-4">
            <Alert tone="warning">
              <span className="font-medium">Publish a template first.</span> A reporting period runs
              against a published template. Once you&apos;ve published one, come back to open a
              period against it.
            </Alert>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setFormOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="space-y-4">
            {error && <Alert tone="danger">{error}</Alert>}
            <div className="grid gap-4 sm:grid-cols-2">
              {!editing && (
                <FormField
                  htmlFor="templateId"
                  label="Template"
                  error={errors.templateId?.message}
                  required
                >
                  {(field) => (
                    <Controller
                      control={form.control}
                      name="templateId"
                      render={({ field: { value, onChange } }) => (
                        <Combobox
                          id={field.id}
                          invalid={!!errors.templateId}
                          value={value ?? ''}
                          onChange={onChange}
                          source={publishedTemplatePicker}
                          emptyLabel="Select a template"
                          placeholder="Search published templates…"
                          aria-label="Template"
                        />
                      )}
                    />
                  )}
                </FormField>
              )}
              {!editing && (
                <FormField
                  htmlFor="frequency"
                  label="Frequency"
                  error={errors.frequency?.message}
                  required
                >
                  {(field) => (
                    <Controller
                      control={form.control}
                      name="frequency"
                      render={({ field: { value, onChange } }) => (
                        <Select
                          id={field.id}
                          invalid={!!errors.frequency}
                          value={value ?? ''}
                          onChange={onChange}
                          options={FREQUENCY_OPTIONS}
                          placeholder="Select a frequency"
                        />
                      )}
                    />
                  )}
                </FormField>
              )}
              <FormField htmlFor="label" label="Label" error={errors.label?.message} required>
                {(field) => (
                  <Input {...field} placeholder="e.g. Q1 2026" {...form.register('label')} />
                )}
              </FormField>
              {!editing && (
                <FormField htmlFor="status" label="Status" error={errors.status?.message} required>
                  {(field) => (
                    <Controller
                      control={form.control}
                      name="status"
                      render={({ field: { value, onChange } }) => (
                        <Select
                          id={field.id}
                          invalid={!!errors.status}
                          value={value ?? ''}
                          onChange={onChange}
                          options={CREATE_STATUS_OPTIONS}
                        />
                      )}
                    />
                  )}
                </FormField>
              )}
              <FormField
                htmlFor="periodStart"
                label="Period start"
                error={errors.periodStart?.message}
                required
              >
                {(field) => (
                  <Controller
                    control={form.control}
                    name="periodStart"
                    render={({ field: { value, onChange } }) => (
                      <DatePicker
                        id={field.id}
                        invalid={!!errors.periodStart}
                        value={value ?? ''}
                        max={form.watch('periodEnd') || undefined}
                        onChange={onChange}
                      />
                    )}
                  />
                )}
              </FormField>
              <FormField
                htmlFor="periodEnd"
                label="Period end"
                error={errors.periodEnd?.message}
                required
              >
                {(field) => (
                  <Controller
                    control={form.control}
                    name="periodEnd"
                    render={({ field: { value, onChange } }) => (
                      <DatePicker
                        id={field.id}
                        invalid={!!errors.periodEnd}
                        value={value ?? ''}
                        min={form.watch('periodStart') || undefined}
                        onChange={onChange}
                      />
                    )}
                  />
                )}
              </FormField>
              <FormField
                htmlFor="dueDate"
                label="Due date"
                error={errors.dueDate?.message}
                required
              >
                {(field) => (
                  <Controller
                    control={form.control}
                    name="dueDate"
                    render={({ field: { value, onChange } }) => (
                      <DatePicker
                        id={field.id}
                        invalid={!!errors.dueDate}
                        value={value ?? ''}
                        min={form.watch('periodEnd') || form.watch('periodStart') || undefined}
                        onChange={onChange}
                      />
                    )}
                  />
                )}
              </FormField>
              <FormField
                htmlFor="graceDays"
                label="Grace days"
                error={errors.graceDays?.message}
                required
              >
                {(field) => (
                  <Input
                    {...field}
                    type="number"
                    min={0}
                    max={60}
                    {...form.register('graceDays')}
                  />
                )}
              </FormField>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setFormOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" isLoading={saveMutation.isPending}>
                {editing ? 'Save changes' : 'Open period'}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirming}
        title="Delete reporting period"
        message={confirming ? `Delete "${confirming.label}"? This cannot be undone.` : ''}
        tone="danger"
        isLoading={deleteMutation.isPending}
        onConfirm={() => confirming && deleteMutation.mutate(confirming.id)}
        onClose={() => setConfirming(null)}
      />
    </ListShell>
  );
}
