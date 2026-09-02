import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Pencil, Plus, Power, Store, Trash2 } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Combobox,
  FilterField,
  ConfirmDialog,
  DescriptionList,
  FormField,
  IconButton,
  Input,
  ListShell,
  Modal,
  PageHeader,
  Select,
  useToast,
  type ActiveFilterChip,
} from '../components/ui';
import { DataTable, type Column, type Density } from '../components/DataTable';
import { useListParams } from '../hooks/useListParams';
import { agentKeys, agentsApi, type AgentInput, type AgentListParams } from '../lib/agents.api';
import { entityPicker } from '../lib/pickers';
import { getErrorMessage } from '../lib/api';
import { activeLabel, activeTone } from '../lib/status';
import { formatDateTime } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { isOperatorRole, type Agent } from '../lib/types';

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
];

const emptyToUndef = (v: unknown) => (v === '' || v == null ? undefined : Number(v));

const agentSchema = z.object({
  agentReference: z.string().min(1, 'Reference is required').max(50),
  name: z.string().min(1, 'Name is required').max(200),
  location: z.string().max(300).optional(),
  latitude: z.preprocess(emptyToUndef, z.number().min(-90).max(90).optional()),
  longitude: z.preprocess(emptyToUndef, z.number().min(-180).max(180).optional()),
  // Only Authority writers set this (which entity the agent belongs to); operators are
  // always scoped to their own entity, so the field isn't shown to them.
  entityId: z.string().optional(),
});

type AgentForm = z.infer<typeof agentSchema>;

function toInput(form: AgentForm): AgentInput {
  const clean = Object.fromEntries(
    Object.entries(form).filter(([, v]) => v !== '' && v !== undefined),
  );
  return clean as unknown as AgentInput;
}

export function AgentsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  // Operators manage their own agents (OPERATOR_ADMIN); on the Authority side, the System
  // Administrator is the one who registers agents on an operator's behalf (mirrors the API's
  // OPERATOR_ADMIN + ADMIN write roles).
  const canWrite = user?.role === 'OPERATOR_ADMIN' || user?.role === 'ADMIN';
  // Operators are scoped to their own entity; Authority roles see every entity's
  // agents, so only they get the Entity column, cross-entity filter, and entity picker.
  const isAuthorityViewer = user ? !isOperatorRole(user.role) : false;

  const [editing, setEditing] = useState<Agent | null>(null);
  const [viewing, setViewing] = useState<Agent | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [confirming, setConfirming] = useState<Agent | null>(null);
  const [error, setError] = useState('');

  // Arriving from an entity's "agents" count pre-filters the list to that entity — and because
  // every filter now lives in the URL, that link keeps working in both directions (§2).
  const list = useListParams({
    defaultSort: 'createdAt',
    defaultOrder: 'desc',
    preferenceKey: 'agents',
    filters: { entityId: '', isActive: '' },
  });
  const [density, setDensity] = useState<Density>('comfortable');

  const params: AgentListParams = {
    page: list.page,
    pageSize: list.pageSize,
    sort: list.sort as AgentListParams['sort'],
    order: list.order,
    search: list.search.trim() || undefined,
    isActive: list.filters.isActive === '' ? undefined : list.filters.isActive === 'true',
    // Authority-only cross-entity filter; ignored by the API for operators.
    entityId: isAuthorityViewer ? list.filters.entityId || undefined : undefined,
  };
  const listQuery = useQuery({
    queryKey: agentKeys.list(params),
    queryFn: () => agentsApi.list(params),
  });

  const activeFilters: ActiveFilterChip[] = [
    ...(list.search
      ? [{ key: 'search', label: 'Matching ' + list.search, onRemove: () => list.setSearch('') }]
      : []),
    ...(list.filters.entityId
      ? [{ key: 'entityId', label: 'One entity', onRemove: () => list.clearFilter('entityId') }]
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

  const form = useForm<AgentForm>({ resolver: zodResolver(agentSchema) });

  const openCreate = () => {
    setEditing(null);
    form.reset({
      agentReference: '',
      name: '',
      location: '',
      // Authority creators must say which entity; default to the current entity filter if set.
      entityId: isAuthorityViewer ? list.filters.entityId || '' : undefined,
    });
    setError('');
    setFormOpen(true);
  };

  const openEdit = (a: Agent) => {
    // One dialog at a time. The details view and the edit form describe the same record, so
    // stacking them shows the user two versions of it at once (§3.9).
    setViewing(null);
    setEditing(a);
    form.reset({
      agentReference: a.agentReference,
      name: a.name,
      location: a.location ?? '',
      latitude: a.latitude ? Number(a.latitude) : undefined,
      longitude: a.longitude ? Number(a.longitude) : undefined,
      entityId: a.entityId,
    });
    setError('');
    setFormOpen(true);
  };

  // Authority writers must pick an entity when registering a new agent (the API requires it).
  const onSubmit = form.handleSubmit((v) => {
    if (isAuthorityViewer && !editing && !v.entityId) {
      form.setError('entityId', { message: 'Choose the entity this agent belongs to' });
      return;
    }
    saveMutation.mutate(v);
  });

  const saveMutation = useMutation({
    mutationFn: (v: AgentForm) => {
      const body = toInput(v);
      if (editing) {
        // An agent's entity is never reassigned, and the update endpoint rejects it.
        const update = { ...body };
        delete update.entityId;
        return agentsApi.update(editing.id, update);
      }
      return agentsApi.create(body);
    },
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: agentKeys.all });
      setFormOpen(false);
      setError('');
      toast.success(`Agent "${a.name}" ${editing ? 'updated' : 'created'}.`);
    },
    onError: (err) => setError(getErrorMessage(err, "We couldn't save the agent")),
  });

  const toggleMutation = useMutation({
    mutationFn: (a: Agent) => agentsApi.update(a.id, { isActive: !a.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: agentKeys.all }),
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't update the agent")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => agentsApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKeys.all });
      setConfirming(null);
      toast.success('Agent deleted.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't delete the agent")),
  });

  const rows = listQuery.data?.data ?? [];

  const columns: Column<Agent>[] = [
    {
      header: 'Reference',
      sortKey: 'agentReference',
      cell: (a) => <span className="font-medium text-gray-900">{a.agentReference}</span>,
    },
    {
      header: 'Name',
      sortKey: 'name',
      cell: (a) => <span className="text-gray-700">{a.name}</span>,
    },
    ...(isAuthorityViewer
      ? [
          {
            header: 'Entity',
            cell: (a: Agent) => <span className="text-gray-600">{a.entity?.name ?? '—'}</span>,
          },
        ]
      : []),
    { header: 'Location', cell: (a) => <span className="text-gray-600">{a.location ?? '—'}</span> },
    {
      header: 'Status',
      sortKey: 'isActive',
      cell: (a) => <Badge tone={activeTone(a.isActive)}>{activeLabel(a.isActive)}</Badge>,
    },
    {
      header: 'Created',
      sortKey: 'createdAt',
      cell: (a) => <span className="text-gray-600">{formatDateTime(a.createdAt)}</span>,
    },
    {
      header: 'Actions',
      align: 'right' as const,
      cell: (a: Agent) => (
        <div className="flex justify-end gap-1">
          <IconButton icon={Eye} label="View this agent" onClick={() => setViewing(a)} />
          {canWrite && (
            <>
              <IconButton icon={Pencil} label="Edit this agent" onClick={() => openEdit(a)} />
              <IconButton
                icon={Power}
                label={a.isActive ? 'Deactivate this agent' : 'Activate this agent'}
                onClick={() => toggleMutation.mutate(a)}
              />
              <IconButton
                icon={Trash2}
                label="Delete this agent"
                variant="danger"
                onClick={() => setConfirming(a)}
              />
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <ListShell
      header={
        <PageHeader
          description={
            isAuthorityViewer
              ? 'Register and manage the cash-in and cash-out agents operating under each entity.'
              : "Register and manage this operator's cash-in and cash-out agents."
          }
          actions={
            canWrite ? (
              <Button onClick={openCreate} icon={Plus}>
                New agent
              </Button>
            ) : undefined
          }
        />
      }
      search={{
        value: list.search,
        onChange: list.setSearch,
        placeholder: 'Name or reference',
        label: 'Search agents',
      }}
      filters={
        <>
          {isAuthorityViewer && (
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
          )}
          <FilterField label="Status" width="sm">
            <Select
              aria-label="Filter by status"
              value={list.filters.isActive}
              options={STATUS_FILTER_OPTIONS}
              onChange={(isActive) => list.setFilters({ isActive })}
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
          <Store size={13} aria-hidden />{' '}
          {isAuthorityViewer
            ? 'Showing agents across all entities. Use the entity filter to narrow by operator.'
            : 'You only see agents that belong to your own entity.'}
        </p>
      }
    >
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(a) => a.id}
        loading={listQuery.isLoading}
        refreshing={listQuery.isFetching && !listQuery.isLoading}
        error={listQuery.isError}
        onRetry={() => void listQuery.refetch()}
        sort={list.sort}
        order={list.order}
        onSortChange={list.setSort}
        density={density}
        onRowClick={(a) => setViewing(a)}
        activeRowKey={viewing?.id}
        emptyMessage={
          list.hasActiveFilters ? 'No agents match your filters.' : 'No agents registered yet.'
        }
        emptyAction={
          list.hasActiveFilters ? (
            <Button variant="secondary" onClick={list.clearAll}>
              Clear filters
            </Button>
          ) : canWrite ? (
            <Button variant="secondary" onClick={openCreate}>
              Register an agent
            </Button>
          ) : undefined
        }
      />

      <Modal open={viewing !== null} title="Agent details" onClose={() => setViewing(null)}>
        {viewing && (
          <div className="space-y-6">
            <DescriptionList
              items={[
                { label: 'Reference', value: viewing.agentReference },
                { label: 'Name', value: viewing.name },
                { label: 'Entity', value: viewing.entity?.name },
                {
                  label: 'Status',
                  value: (
                    <Badge tone={activeTone(viewing.isActive)}>
                      {activeLabel(viewing.isActive)}
                    </Badge>
                  ),
                },
                { label: 'Location', value: viewing.location, full: true },
                { label: 'Latitude', value: viewing.latitude },
                { label: 'Longitude', value: viewing.longitude },
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
        title={editing ? 'Edit agent' : 'Register a new agent'}
        onClose={() => setFormOpen(false)}
      >
        <form onSubmit={onSubmit} className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          {isAuthorityViewer &&
            (editing ? (
              <FormField htmlFor="agent-entity-view" label="Entity">
                {() => (
                  <Input
                    id="agent-entity-view"
                    value={editing.entity?.name ?? '—'}
                    readOnly
                    disabled
                  />
                )}
              </FormField>
            ) : (
              <FormField
                htmlFor="agent-entity"
                label="Entity"
                error={form.formState.errors.entityId?.message}
                required
              >
                {(field) => (
                  <Controller
                    control={form.control}
                    name="entityId"
                    render={({ field: { value, onChange } }) => (
                      <Combobox
                        id={field.id}
                        value={value ?? ''}
                        onChange={onChange}
                        source={entityPicker}
                        emptyLabel="Select the operator this agent belongs to"
                        placeholder="Search entities…"
                        invalid={!!form.formState.errors.entityId}
                        aria-label="Entity"
                      />
                    )}
                  />
                )}
              </FormField>
            ))}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              htmlFor="agentReference"
              label="Agent reference"
              error={form.formState.errors.agentReference?.message}
              required
            >
              {(field) => (
                <Input
                  {...field}
                  placeholder="e.g. AG-00123"
                  {...form.register('agentReference')}
                />
              )}
            </FormField>
            <FormField
              htmlFor="agent-name"
              label="Name"
              error={form.formState.errors.name?.message}
              required
            >
              {(field) => (
                <Input
                  {...field}
                  placeholder="e.g. Konyokonyo Market Kiosk"
                  {...form.register('name')}
                />
              )}
            </FormField>
            <FormField htmlFor="location" label="Location">
              {(field) => (
                <Input {...field} placeholder="e.g. Juba" {...form.register('location')} />
              )}
            </FormField>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                htmlFor="latitude"
                label="Latitude"
                error={form.formState.errors.latitude?.message}
              >
                {(field) => (
                  <Input
                    {...field}
                    type="number"
                    step="any"
                    placeholder="e.g. 4.85"
                    {...form.register('latitude')}
                  />
                )}
              </FormField>
              <FormField
                htmlFor="longitude"
                label="Longitude"
                error={form.formState.errors.longitude?.message}
              >
                {(field) => (
                  <Input
                    {...field}
                    type="number"
                    step="any"
                    placeholder="e.g. 31.58"
                    {...form.register('longitude')}
                  />
                )}
              </FormField>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={saveMutation.isPending}>
              {editing ? 'Save changes' : 'Register agent'}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirming !== null}
        title="Delete agent"
        message={
          confirming ? `Delete agent ${confirming.agentReference}? This cannot be undone.` : ''
        }
        tone="danger"
        isLoading={deleteMutation.isPending}
        onConfirm={() => confirming && deleteMutation.mutate(confirming.id)}
        onClose={() => setConfirming(null)}
      />
    </ListShell>
  );
}
