import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { CopyPlus, FileText, Pencil, Plus, Trash2 } from 'lucide-react';
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
  RelativeTime,
  Select,
  useToast,
  type ActiveFilterChip,
  type SelectOption,
} from '../components/ui';
import { DataTable, type Column, type Density } from '../components/DataTable';
import { useListParams } from '../hooks/useListParams';
import { templatesApi, templateKeys, type TemplateListParams } from '../lib/templates.api';
import { getErrorMessage } from '../lib/api';
import { TEMPLATE_STATUS_TONE } from '../lib/status';

import { TEMPLATE_STATUSES, type TemplateListRow, type TemplateStatus } from '../lib/types';

// No status→label map ships in lib/types, so the list owns its own display labels.
const STATUS_LABELS: Record<TemplateStatus, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
};

const STATUS_FILTER_OPTIONS: SelectOption[] = [
  { value: '', label: 'All statuses' },
  ...TEMPLATE_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })),
];

const createSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  description: z.string().max(1000).optional(),
});

type CreateForm = z.infer<typeof createSchema>;

export function TemplatesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();

  const list = useListParams({
    defaultSort: 'updatedAt',
    defaultOrder: 'desc',
    preferenceKey: 'templates',
    filters: { status: '' },
  });
  const [density, setDensity] = useState<Density>('comfortable');
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState('');
  const [confirming, setConfirming] = useState<TemplateListRow | null>(null);

  const params: TemplateListParams = {
    page: list.page,
    pageSize: list.pageSize,
    sort: list.sort as TemplateListParams['sort'],
    order: list.order,
    search: list.search || undefined,
    status: (list.filters.status || undefined) as TemplateStatus | undefined,
  };

  const listQuery = useQuery({
    queryKey: templateKeys.list(params),
    queryFn: () => templatesApi.list(params),
  });

  const activeFilters: ActiveFilterChip[] = [
    ...(list.search
      ? [{ key: 'search', label: `Matching ${list.search}`, onRemove: () => list.setSearch('') }]
      : []),
    ...(list.filters.status
      ? [
          {
            key: 'status',
            label: STATUS_LABELS[list.filters.status as TemplateStatus],
            onRemove: () => list.clearFilter('status'),
          },
        ]
      : []),
  ];

  const form = useForm<CreateForm>({ resolver: zodResolver(createSchema) });
  const { errors } = form.formState;

  const openCreate = () => {
    form.reset({ name: '', description: '' });
    setCreateError('');
    setCreateOpen(true);
  };

  const createMutation = useMutation({
    mutationFn: (v: CreateForm) =>
      templatesApi.create({ name: v.name, description: v.description || undefined }),
    onSuccess: (tpl) => {
      qc.invalidateQueries({ queryKey: templateKeys.all });
      setCreateOpen(false);
      toast.success(`Template "${tpl.name}" created.`);
      navigate(`/templates/${tpl.id}`);
    },
    onError: (err) => setCreateError(getErrorMessage(err, "We couldn't create the template")),
  });

  const newVersionMutation = useMutation({
    mutationFn: (rowId: string) => templatesApi.newVersion(rowId),
    onSuccess: (tpl) => {
      qc.invalidateQueries({ queryKey: templateKeys.all });
      toast.success(`Draft v${tpl.version} created.`);
      navigate(`/templates/${tpl.id}`);
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't create a new version")),
  });

  const deleteMutation = useMutation({
    mutationFn: (rowId: string) => templatesApi.remove(rowId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: templateKeys.all });
      setConfirming(null);
      toast.success('Template deleted.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't delete the template")),
  });

  const rows = listQuery.data?.data ?? [];

  const columns: Column<TemplateListRow>[] = [
    {
      header: 'Name',
      sortKey: 'name',
      cell: (t) => <span className="font-medium text-gray-900">{t.name}</span>,
    },
    {
      header: 'Version',
      sortKey: 'version',
      width: '6rem',
      cell: (t) => <span className="text-gray-600">v{t.version}</span>,
    },
    {
      header: 'Status',
      sortKey: 'status',
      width: '8rem',
      cell: (t) => <Badge tone={TEMPLATE_STATUS_TONE[t.status]}>{STATUS_LABELS[t.status]}</Badge>,
    },
    {
      header: 'Sections',
      width: '6rem',
      hideOnMobile: true,
      cell: (t) => <span className="text-gray-600">{t._count.sections}</span>,
    },
    {
      header: 'Published',
      width: '10rem',
      hideOnMobile: true,
      cell: (t) => <RelativeTime value={t.publishedAt} className="text-gray-500" />,
    },
    {
      header: 'Updated',
      width: '10rem',
      cell: (t) => <RelativeTime value={t.updatedAt} className="text-gray-500" />,
    },
    {
      header: 'Actions',
      align: 'right',
      width: '9rem',
      cell: (t) => (
        <div className="flex justify-end gap-1">
          <IconButton
            icon={Pencil}
            label="Edit this template"
            onClick={() => navigate(`/templates/${t.id}`)}
          />
          <IconButton
            icon={CopyPlus}
            label="Start a new version"
            onClick={() => newVersionMutation.mutate(t.id)}
          />
          <IconButton
            icon={Trash2}
            label="Delete this template"
            variant="danger"
            onClick={() => setConfirming(t)}
          />
        </div>
      ),
    },
  ];

  return (
    <ListShell
      header={
        <PageHeader
          description="Build the questionnaires operators report against. Set the sections, fields, and which entity types each one applies to."
          actions={
            <Button onClick={openCreate} icon={Plus}>
              New template
            </Button>
          }
        />
      }
      search={{
        value: list.search,
        onChange: list.setSearch,
        placeholder: 'Search by name',
        label: 'Search templates',
      }}
      filters={
        <FilterField label="Status" width="md">
          <Select
            aria-label="Filter by status"
            value={list.filters.status}
            options={STATUS_FILTER_OPTIONS}
            onChange={(status) => list.setFilters({ status })}
          />
        </FilterField>
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
          <FileText size={13} aria-hidden /> You can only edit drafts. Publishing locks the version,
          so make any later changes in a new version.
        </p>
      }
    >
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(t) => t.id}
        loading={listQuery.isLoading}
        refreshing={listQuery.isFetching && !listQuery.isLoading}
        error={listQuery.isError}
        onRetry={() => void listQuery.refetch()}
        sort={list.sort}
        order={list.order}
        onSortChange={list.setSort}
        density={density}
        onRowClick={(t) => navigate(`/templates/${t.id}`)}
        emptyMessage={
          list.hasActiveFilters
            ? 'No templates match your filters.'
            : 'No questionnaires have been built yet.'
        }
        emptyAction={
          list.hasActiveFilters ? (
            <Button variant="secondary" onClick={list.clearAll}>
              Clear filters
            </Button>
          ) : (
            <Button variant="secondary" onClick={openCreate}>
              Create a template
            </Button>
          )
        }
      />

      <Modal
        open={createOpen}
        title="New template"
        onClose={() => setCreateOpen(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="new-template-form" isLoading={createMutation.isPending}>
              Create template
            </Button>
          </div>
        }
      >
        <form
          id="new-template-form"
          onSubmit={form.handleSubmit((v) => createMutation.mutate(v))}
          className="space-y-4"
        >
          {createError && <Alert tone="danger">{createError}</Alert>}
          <FormField htmlFor="name" label="Name" error={errors.name?.message} required>
            {(field) => (
              <Input
                {...field}
                placeholder="e.g. Annual Telecom Return 2026"
                {...form.register('name')}
              />
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
                placeholder="What this questionnaire collects"
                {...form.register('description')}
              />
            )}
          </FormField>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!confirming}
        title="Delete template"
        message={
          confirming
            ? `Delete "${confirming.name}" (v${confirming.version})? This cannot be undone.`
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
