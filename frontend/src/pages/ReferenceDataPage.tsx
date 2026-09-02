import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListChecks, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  FormField,
  IconButton,
  Input,
  FilterField,
  ListShell,
  Modal,
  PageHeader,
  Select,
  useToast,
} from '../components/ui';
import { DataTable, type Column, type Density } from '../components/DataTable';
import { useListParams } from '../hooks/useListParams';
import type { ActiveFilterChip } from '../components/ui';
import {
  referenceApi,
  referenceKeys,
  type ReferenceItemInput,
  type ReferenceListParams,
} from '../lib/reference.api';
import { getErrorMessage } from '../lib/api';
import {
  REFERENCE_CATEGORIES,
  REFERENCE_CATEGORY_LABELS,
  type ReferenceCategory,
  type ReferenceItem,
} from '../lib/types';
import { activeLabel, activeTone } from '../lib/status';
import { formatDateTime } from '../lib/format';

const CATEGORY_OPTIONS = REFERENCE_CATEGORIES.map((c) => ({
  value: c,
  label: REFERENCE_CATEGORY_LABELS[c],
}));

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
];

const emptyToUndef = (v: unknown) => (v === '' || v == null ? undefined : Number(v));

const itemSchema = z.object({
  code: z
    .string()
    .min(1, 'Code is required')
    .max(50)
    .regex(/^[A-Za-z0-9_-]+$/, 'Letters, digits, _ and - only'),
  label: z.string().min(1, 'Label is required').max(150),
  description: z.string().max(300).optional(),
  sortOrder: z.preprocess(emptyToUndef, z.number().int().min(0).optional()),
});

type ItemForm = z.infer<typeof itemSchema>;

export function ReferenceDataPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useListParams({
    defaultSort: 'sortOrder',
    defaultOrder: 'asc',
    preferenceKey: 'reference-data',
    filters: { category: 'SPECTRUM_BAND', isActive: '' },
  });
  const [density, setDensity] = useState<Density>('comfortable');

  const params: ReferenceListParams = {
    page: list.page,
    pageSize: list.pageSize,
    sort: list.sort as ReferenceListParams['sort'],
    order: list.order,
    search: list.search || undefined,
    category: list.filters.category as ReferenceCategory,
    isActive: list.filters.isActive === '' ? undefined : list.filters.isActive === 'true',
  };
  const [editing, setEditing] = useState<ReferenceItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [confirming, setConfirming] = useState<ReferenceItem | null>(null);
  const [error, setError] = useState('');

  const listQuery = useQuery({
    queryKey: referenceKeys.list(params),
    queryFn: () => referenceApi.list(params),
  });

  const activeFilters: ActiveFilterChip[] = [
    ...(list.search
      ? [{ key: 'search', label: `Matching ${list.search}`, onRemove: () => list.setSearch('') }]
      : []),
    ...(list.filters.isActive
      ? [
          {
            key: 'isActive',
            label: list.filters.isActive === 'true' ? 'Active only' : 'Inactive only',
            onRemove: () => list.clearFilter('isActive'),
          },
        ]
      : []),
  ];

  const form = useForm<ItemForm>({ resolver: zodResolver(itemSchema) });
  const { errors } = form.formState;

  const openCreate = () => {
    setEditing(null);
    form.reset({ code: '', label: '', description: '', sortOrder: undefined });
    setError('');
    setFormOpen(true);
  };

  const openEdit = (item: ReferenceItem) => {
    setEditing(item);
    form.reset({
      code: item.code,
      label: item.label,
      description: item.description ?? '',
      sortOrder: item.sortOrder,
    });
    setError('');
    setFormOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: (v: ItemForm) => {
      if (editing) {
        return referenceApi.update(editing.id, {
          label: v.label,
          description: v.description || undefined,
          sortOrder: v.sortOrder,
        });
      }
      const body: ReferenceItemInput = {
        category: params.category as ReferenceCategory,
        code: v.code,
        label: v.label,
        description: v.description || undefined,
        sortOrder: v.sortOrder,
      };
      return referenceApi.create(body);
    },
    onSuccess: (item) => {
      qc.invalidateQueries({ queryKey: referenceKeys.all });
      setFormOpen(false);
      setError('');
      toast.success(`"${item.label}" ${editing ? 'updated' : 'added'}.`);
    },
    onError: (err) => setError(getErrorMessage(err, "We couldn't save the value")),
  });

  const toggleMutation = useMutation({
    mutationFn: (item: ReferenceItem) => referenceApi.update(item.id, { isActive: !item.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: referenceKeys.all }),
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't update the value")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => referenceApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: referenceKeys.all });
      setConfirming(null);
      toast.success('Item deleted.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't delete the value")),
  });

  const rows = listQuery.data?.data ?? [];

  const columns: Column<ReferenceItem>[] = [
    {
      header: 'Code',
      sortKey: 'code',
      cell: (i) => <span className="font-mono text-xs text-gray-600">{i.code}</span>,
    },
    {
      header: 'Label',
      sortKey: 'label',
      cell: (i) => <span className="font-medium text-gray-900">{i.label}</span>,
    },
    {
      header: 'Order',
      sortKey: 'sortOrder',
      cell: (i) => <span className="text-gray-500">{i.sortOrder}</span>,
    },
    {
      header: 'Status',
      sortKey: 'isActive',
      cell: (i) => <Badge tone={activeTone(i.isActive)}>{activeLabel(i.isActive)}</Badge>,
    },
    {
      header: 'Created',
      sortKey: 'createdAt',
      cell: (i) => <span className="text-gray-500">{formatDateTime(i.createdAt)}</span>,
    },
    {
      header: 'Actions',
      align: 'right',
      cell: (i) => (
        <div className="flex justify-end gap-1">
          <IconButton icon={Pencil} label="Edit this value" onClick={() => openEdit(i)} />
          <IconButton
            icon={Power}
            label={i.isActive ? 'Deactivate this value' : 'Activate this value'}
            onClick={() => toggleMutation.mutate(i)}
          />
          <IconButton
            icon={Trash2}
            label="Delete this value"
            variant="danger"
            onClick={() => setConfirming(i)}
          />
        </div>
      ),
    },
  ];

  return (
    <ListShell
      header={
        <PageHeader
          description="Manage the lists the questionnaire uses for its options. You can add values any time."
          actions={
            <Button onClick={openCreate} icon={Plus}>
              Add value
            </Button>
          }
        />
      }
      search={{
        value: list.search,
        onChange: list.setSearch,
        placeholder: 'Code or label',
        label: 'Search reference values',
      }}
      filters={
        <>
          <FilterField label="List" width="lg">
            <Select
              value={list.filters.category}
              onChange={(category) => list.setFilters({ category })}
              options={CATEGORY_OPTIONS}
              aria-label="Category"
            />
          </FilterField>
          <FilterField label="Status" width="sm">
            <Select
              value={list.filters.isActive}
              onChange={(isActive) => list.setFilters({ isActive })}
              options={STATUS_FILTER_OPTIONS}
              aria-label="Filter by status"
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
          <ListChecks size={13} aria-hidden /> Recurring {'"Other"'} answers from returns can be
          added here as proper options.
        </p>
      }
    >
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(i) => i.id}
        loading={listQuery.isLoading}
        refreshing={listQuery.isFetching && !listQuery.isLoading}
        error={listQuery.isError}
        onRetry={() => void listQuery.refetch()}
        sort={list.sort}
        order={list.order}
        onSortChange={list.setSort}
        density={density}
        emptyMessage={
          list.hasActiveFilters ? 'No values match your filters.' : 'No values in this list yet.'
        }
        emptyAction={
          list.hasActiveFilters ? (
            <Button variant="secondary" onClick={list.clearAll}>
              Clear filters
            </Button>
          ) : (
            <Button variant="secondary" onClick={openCreate}>
              Add the first value
            </Button>
          )
        }
      />

      <Modal
        open={formOpen}
        title={
          editing
            ? 'Edit value'
            : `Add a value to ${REFERENCE_CATEGORY_LABELS[params.category as ReferenceCategory]}`
        }
        onClose={() => setFormOpen(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="reference-item-form" isLoading={saveMutation.isPending}>
              {editing ? 'Save changes' : 'Add value'}
            </Button>
          </div>
        }
      >
        <form
          id="reference-item-form"
          onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))}
          className="space-y-4"
        >
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField htmlFor="code" label="Code" error={errors.code?.message} required>
              {(field) => (
                <Input
                  {...field}
                  placeholder="e.g. MHZ_900"
                  disabled={!!editing}
                  {...form.register('code')}
                />
              )}
            </FormField>
            <FormField htmlFor="label" label="Label" error={errors.label?.message} required>
              {(field) => (
                <Input {...field} placeholder="e.g. 900 MHz" {...form.register('label')} />
              )}
            </FormField>
            <FormField
              htmlFor="description"
              label="Description (optional)"
              error={errors.description?.message}
            >
              {(field) => (
                <Input
                  {...field}
                  placeholder="e.g. GSM 900 MHz band"
                  {...form.register('description')}
                />
              )}
            </FormField>
            <FormField htmlFor="sortOrder" label="Sort order" error={errors.sortOrder?.message}>
              {(field) => (
                <Input
                  {...field}
                  type="number"
                  min={0}
                  placeholder="e.g. 10"
                  {...form.register('sortOrder')}
                />
              )}
            </FormField>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!confirming}
        title="Delete value"
        message={confirming ? `Delete "${confirming.label}"? This cannot be undone.` : ''}
        tone="danger"
        isLoading={deleteMutation.isPending}
        onConfirm={() => confirming && deleteMutation.mutate(confirming.id)}
        onClose={() => setConfirming(null)}
      />
    </ListShell>
  );
}
