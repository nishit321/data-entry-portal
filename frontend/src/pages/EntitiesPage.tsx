import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  DatePicker,
  DescriptionList,
  FormField,
  IconButton,
  Input,
  FilterField,
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
  entitiesApi,
  entityKeys,
  type EntityInput,
  type EntityListParams,
} from '../lib/entities.api';
import { getErrorMessage } from '../lib/api';
import { ENTITY_STATUS_TONE } from '../lib/status';
import { formatDate, formatDateTime } from '../lib/format';
import {
  ENTITY_STATUS_LABELS,
  ENTITY_STATUSES,
  ENTITY_TYPE_LABELS,
  ENTITY_TYPES,
  type Entity,
  type EntityListRow,
  type EntityStatus,
  type EntityType,
} from '../lib/types';

const TYPE_OPTIONS: SelectOption[] = ENTITY_TYPES.map((t) => ({
  value: t,
  label: ENTITY_TYPE_LABELS[t],
}));
const STATUS_OPTIONS: SelectOption[] = ENTITY_STATUSES.map((s) => ({
  value: s,
  label: ENTITY_STATUS_LABELS[s],
}));
const TYPE_FILTER_OPTIONS: SelectOption[] = [{ value: '', label: 'All types' }, ...TYPE_OPTIONS];
const STATUS_FILTER_OPTIONS: SelectOption[] = [
  { value: '', label: 'All statuses' },
  ...STATUS_OPTIONS,
];

const entitySchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  type: z.enum(ENTITY_TYPES),
  licenceNumber: z.string().min(1, 'Licence number is required').max(100),
  licenceIssuedAt: z.string().optional(),
  geographicScope: z.string().max(200).optional(),
  headquartersAddress: z.string().max(500).optional(),
  primaryContactName: z.string().max(150).optional(),
  primaryContactEmail: z.string().email('Enter a valid email').optional().or(z.literal('')),
  primaryContactPhone: z.string().max(50).optional(),
});

type EntityForm = z.infer<typeof entitySchema>;

/** Drop empty-string optionals so we never send blanks that fail server validation. */
function toInput(form: EntityForm): EntityInput {
  const clean = Object.fromEntries(
    Object.entries(form).filter(([, v]) => v !== '' && v !== undefined),
  );
  return clean as unknown as EntityInput;
}

export function EntitiesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useListParams({
    defaultSort: 'createdAt',
    defaultOrder: 'desc',
    preferenceKey: 'entities',
    filters: { type: '', status: '' },
  });
  const [density, setDensity] = useState<Density>('comfortable');

  const params: EntityListParams = {
    page: list.page,
    pageSize: list.pageSize,
    sort: list.sort as EntityListParams['sort'],
    order: list.order,
    search: list.search || undefined,
    type: (list.filters.type || undefined) as EntityListParams['type'],
    status: (list.filters.status || undefined) as EntityListParams['status'],
  };
  const [editing, setEditing] = useState<Entity | null>(null);
  const [viewing, setViewing] = useState<Entity | null>(null);
  // Status is a separate lifecycle transition (own endpoint + audit), tracked
  // outside the profile form and only editable when editing an existing entity.
  const [editStatus, setEditStatus] = useState<EntityStatus>('PENDING');
  const [formOpen, setFormOpen] = useState(false);
  const [confirming, setConfirming] = useState<EntityListRow | null>(null);
  const [error, setError] = useState('');

  const listQuery = useQuery({
    queryKey: entityKeys.list(params),
    queryFn: () => entitiesApi.list(params),
  });

  const activeFilters: ActiveFilterChip[] = [
    ...(list.search
      ? [{ key: 'search', label: 'Matching ' + list.search, onRemove: () => list.setSearch('') }]
      : []),
    ...(list.filters.type
      ? [
          {
            key: 'type',
            label: ENTITY_TYPE_LABELS[list.filters.type as EntityType],
            onRemove: () => list.clearFilter('type'),
          },
        ]
      : []),
    ...(list.filters.status
      ? [
          {
            key: 'status',
            label: ENTITY_STATUS_LABELS[list.filters.status as EntityStatus],
            onRemove: () => list.clearFilter('status'),
          },
        ]
      : []),
  ];

  const form = useForm<EntityForm>({ resolver: zodResolver(entitySchema) });
  const { errors } = form.formState;

  const openCreate = () => {
    setEditing(null);
    form.reset({ name: '', type: 'MNO', licenceNumber: '' });
    setError('');
    setFormOpen(true);
  };

  const openEdit = async (id: string) => {
    try {
      const entity = await entitiesApi.get(id);
      // One dialog at a time — the details view and the edit form describe the same record (§3.9).
      setViewing(null);
      setEditing(entity);
      setEditStatus(entity.status);
      form.reset({
        name: entity.name,
        type: entity.type,
        licenceNumber: entity.licenceNumber,
        licenceIssuedAt: entity.licenceIssuedAt?.slice(0, 10) ?? '',
        geographicScope: entity.geographicScope ?? '',
        headquartersAddress: entity.headquartersAddress ?? '',
        primaryContactName: entity.primaryContactName ?? '',
        primaryContactEmail: entity.primaryContactEmail ?? '',
        primaryContactPhone: entity.primaryContactPhone ?? '',
      });
      setError('');
      setFormOpen(true);
    } catch (err) {
      toast.error(getErrorMessage(err, "We couldn't load that entity"));
    }
  };

  // The list row is a light projection, so fetch the full record for the view.
  const openView = async (id: string) => {
    try {
      setViewing(await entitiesApi.get(id));
    } catch (err) {
      toast.error(getErrorMessage(err, "We couldn't load that entity"));
    }
  };

  const saveMutation = useMutation({
    mutationFn: async (values: EntityForm) => {
      if (!editing) return entitiesApi.create(toInput(values));
      const updated = await entitiesApi.update(editing.id, toInput(values));
      // A status change is a distinct transition with its own audit trail, so
      // it goes through the dedicated endpoint — only when it actually changed.
      if (editStatus !== editing.status) {
        return entitiesApi.setStatus(editing.id, editStatus);
      }
      return updated;
    },
    onSuccess: (entity) => {
      qc.invalidateQueries({ queryKey: entityKeys.all });
      setFormOpen(false);
      setError('');
      toast.success(`Entity "${entity.name}" ${editing ? 'updated' : 'created'}.`);
    },
    onError: (err) => setError(getErrorMessage(err, "We couldn't save the entity")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => entitiesApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: entityKeys.all });
      setConfirming(null);
      toast.success('Entity deleted.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't delete the entity")),
  });

  const rows = listQuery.data?.data ?? [];

  const columns: Column<EntityListRow>[] = [
    {
      header: 'Name',
      sortKey: 'name',
      cell: (e) => <span className="font-medium text-gray-900">{e.name}</span>,
    },
    {
      header: 'Type',
      sortKey: 'type',
      cell: (e) => <Badge tone="info">{ENTITY_TYPE_LABELS[e.type]}</Badge>,
    },
    { header: 'Licence', cell: (e) => <span className="text-gray-600">{e.licenceNumber}</span> },
    {
      header: 'Agents',
      // Links through to this entity's agents (pre-filtered), where they can be viewed or added.
      cell: (e) => (
        <Link
          to={`/agents?entity=${e.id}`}
          className="font-medium text-brand hover:underline"
          title="View or add this entity's agents"
        >
          {e._count.agents}
        </Link>
      ),
    },
    {
      header: 'Status',
      sortKey: 'status',
      cell: (e) => (
        <Badge tone={ENTITY_STATUS_TONE[e.status]}>{ENTITY_STATUS_LABELS[e.status]}</Badge>
      ),
    },
    {
      header: 'Created',
      sortKey: 'createdAt',
      cell: (e) => <span className="text-gray-500">{formatDateTime(e.createdAt)}</span>,
    },
    {
      header: 'Actions',
      align: 'right',
      cell: (e) => (
        <div className="flex justify-end gap-1">
          <IconButton icon={Eye} label="View this entity" onClick={() => openView(e.id)} />
          <IconButton icon={Pencil} label="Edit this entity" onClick={() => openEdit(e.id)} />
          <IconButton
            icon={Trash2}
            label="Delete this entity"
            variant="danger"
            onClick={() => setConfirming(e)}
          />
        </div>
      ),
    },
  ];

  return (
    <ListShell
      header={
        <PageHeader
          description="Add and manage the regulated operators, ISPs, and mobile-money providers."
          actions={
            <Button onClick={openCreate} icon={Plus}>
              New entity
            </Button>
          }
        />
      }
      search={{
        value: list.search,
        onChange: list.setSearch,
        placeholder: 'Name or licence number',
        label: 'Search entities',
      }}
      filters={
        <>
          <FilterField label="Type" width="lg">
            <Select
              id="type-filter"
              aria-label="Filter by type"
              value={list.filters.type}
              options={TYPE_FILTER_OPTIONS}
              onChange={(type) => list.setFilters({ type })}
            />
          </FilterField>
          <FilterField label="Status" width="md">
            <Select
              id="status-filter"
              aria-label="Filter by status"
              value={list.filters.status}
              options={STATUS_FILTER_OPTIONS}
              onChange={(status) => list.setFilters({ status })}
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
          <Building2 size={13} aria-hidden /> Entities keep data separate. Operator users only see
          their own entity.
        </p>
      }
    >
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(e) => e.id}
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
            ? 'No entities match your filters.'
            : 'No entities are registered yet.'
        }
        emptyAction={
          list.hasActiveFilters ? (
            <Button variant="secondary" onClick={list.clearAll}>
              Clear filters
            </Button>
          ) : (
            <Button variant="secondary" onClick={openCreate}>
              Add an entity
            </Button>
          )
        }
      />

      <Modal
        open={viewing !== null}
        title={viewing?.name ?? 'Entity details'}
        onClose={() => setViewing(null)}
      >
        {viewing && (
          <div className="space-y-6">
            <DescriptionList
              items={[
                { label: 'Type', value: ENTITY_TYPE_LABELS[viewing.type] },
                {
                  label: 'Status',
                  value: (
                    <Badge tone={ENTITY_STATUS_TONE[viewing.status]}>
                      {ENTITY_STATUS_LABELS[viewing.status]}
                    </Badge>
                  ),
                },
                { label: 'Licence number', value: viewing.licenceNumber },
                { label: 'Licence issued', value: formatDate(viewing.licenceIssuedAt) },
                { label: 'Years in operation', value: viewing.yearsInOperation },
                { label: 'Geographic scope', value: viewing.geographicScope },
                { label: 'Headquarters', value: viewing.headquartersAddress, full: true },
                { label: 'Contact name', value: viewing.primaryContactName },
                { label: 'Contact title', value: viewing.primaryContactTitle },
                { label: 'Contact email', value: viewing.primaryContactEmail },
                { label: 'Contact phone', value: viewing.primaryContactPhone },
                { label: 'Created', value: formatDateTime(viewing.createdAt) },
                { label: 'Updated', value: formatDateTime(viewing.updatedAt) },
              ]}
            />
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setViewing(null)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={formOpen}
        title={editing ? 'Edit entity' : 'Add a new entity'}
        onClose={() => setFormOpen(false)}
      >
        <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField htmlFor="name" label="Name" error={errors.name?.message} required>
              {(field) => (
                <Input {...field} placeholder="e.g. Zain South Sudan" {...form.register('name')} />
              )}
            </FormField>
            <FormField htmlFor="type" label="Type" error={errors.type?.message} required>
              {(field) => (
                <Controller
                  control={form.control}
                  name="type"
                  render={({ field: { value, onChange } }) => (
                    <Select
                      id={field.id}
                      invalid={!!errors.type}
                      value={value ?? ''}
                      onChange={onChange}
                      options={TYPE_OPTIONS}
                      placeholder="Select a type"
                    />
                  )}
                />
              )}
            </FormField>
            {editing && (
              <FormField htmlFor="status" label="Status">
                {(field) => (
                  <Select
                    id={field.id}
                    value={editStatus}
                    onChange={(value) => setEditStatus(value as EntityStatus)}
                    options={STATUS_OPTIONS}
                  />
                )}
              </FormField>
            )}
            <FormField
              htmlFor="licenceNumber"
              label="Licence number"
              error={errors.licenceNumber?.message}
              required
            >
              {(field) => (
                <Input
                  {...field}
                  placeholder="e.g. NCA/MNO/2026/001"
                  {...form.register('licenceNumber')}
                />
              )}
            </FormField>
            <FormField
              htmlFor="licenceIssuedAt"
              label="Licence issued"
              error={errors.licenceIssuedAt?.message}
            >
              {(field) => (
                <Controller
                  control={form.control}
                  name="licenceIssuedAt"
                  render={({ field: { value, onChange } }) => (
                    <DatePicker
                      id={field.id}
                      invalid={!!errors.licenceIssuedAt}
                      value={value ?? ''}
                      onChange={onChange}
                    />
                  )}
                />
              )}
            </FormField>
            <FormField
              htmlFor="geographicScope"
              label="Geographic scope"
              error={errors.geographicScope?.message}
            >
              {(field) => (
                <Input
                  {...field}
                  placeholder="National / Regional"
                  {...form.register('geographicScope')}
                />
              )}
            </FormField>
            <FormField
              htmlFor="headquartersAddress"
              label="Headquarters address"
              error={errors.headquartersAddress?.message}
            >
              {(field) => (
                <Input
                  {...field}
                  placeholder="e.g. Juba, Central Equatoria"
                  {...form.register('headquartersAddress')}
                />
              )}
            </FormField>
            <FormField
              htmlFor="primaryContactName"
              label="Contact name"
              error={errors.primaryContactName?.message}
            >
              {(field) => (
                <Input
                  {...field}
                  placeholder="e.g. Grace Deng"
                  {...form.register('primaryContactName')}
                />
              )}
            </FormField>
            <FormField
              htmlFor="primaryContactEmail"
              label="Contact email"
              error={errors.primaryContactEmail?.message}
            >
              {(field) => (
                <Input
                  {...field}
                  placeholder="name@example.com"
                  {...form.register('primaryContactEmail')}
                />
              )}
            </FormField>
            <FormField
              htmlFor="primaryContactPhone"
              label="Contact phone"
              error={errors.primaryContactPhone?.message}
            >
              {(field) => (
                <Input
                  {...field}
                  placeholder="e.g. +211 92 123 4567"
                  {...form.register('primaryContactPhone')}
                />
              )}
            </FormField>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={saveMutation.isPending}>
              {editing ? 'Save changes' : 'Create entity'}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!confirming}
        title="Delete entity"
        message={confirming ? `Delete ${confirming.name}? This cannot be undone.` : ''}
        tone="danger"
        isLoading={deleteMutation.isPending}
        onConfirm={() => confirming && deleteMutation.mutate(confirming.id)}
        onClose={() => setConfirming(null)}
      />
    </ListShell>
  );
}
