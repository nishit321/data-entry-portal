import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Download, FileText, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Checkbox,
  Combobox,
  ConfirmDialog,
  Field,
  FilterField,
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
import { DataTable, type Column } from '../components/DataTable';
import { documentsApi, documentKeys, type DocumentListParams } from '../lib/documents.api';
import { useListParams } from '../hooks/useListParams';
import { entityPicker } from '../lib/pickers';
import { getErrorMessage } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { DOCUMENT_EXPIRY_TONE } from '../lib/status';
import { formatDate, formatFileSize, joinMeta } from '../lib/format';
import {
  DOCUMENT_ACCEPT,
  DOCUMENT_KIND_LABELS,
  DOCUMENT_KINDS,
  ENTITY_TYPE_LABELS,
  isOperatorRole,
  type DocumentKind,
  type DocumentRecord,
} from '../lib/types';

const KIND_FILTER_OPTIONS: SelectOption[] = [
  { value: '', label: 'All types' },
  ...DOCUMENT_KINDS.map((k) => ({ value: k, label: DOCUMENT_KIND_LABELS[k] })),
];
const KIND_OPTIONS: SelectOption[] = DOCUMENT_KINDS.map((k) => ({
  value: k,
  label: DOCUMENT_KIND_LABELS[k],
}));

const BLANK_FORM = {
  kind: 'LICENCE' as DocumentKind,
  title: '',
  reference: '',
  issuedAt: '',
  expiresAt: '',
};

/** Plain-language expiry wording; the badge tone comes from the shared map. */
function expiryLabel(doc: DocumentRecord): string {
  const days = doc.expiry.daysRemaining;
  if (days === null) return '';
  if (doc.expiry.stage === 'EXPIRED') {
    return days === -1 ? 'Expired yesterday' : `Expired ${Math.abs(days)} days ago`;
  }
  if (days === 0) return 'Expires today';
  return `${days} days left`;
}

export function DocumentsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isOperator = !!user && isOperatorRole(user.role);
  const isAdmin = user?.role === 'ADMIN';
  // An operator admin files their own documents; an Authority admin can file on anyone's behalf.
  const canUpload = user?.role === 'OPERATOR_ADMIN' || isAdmin;
  const canSweep = isAdmin || user?.role === 'SUPERVISOR';

  const list = useListParams({
    defaultSort: 'createdAt',
    defaultOrder: 'desc',
    preferenceKey: 'documents',
    filters: { kind: '', entityId: '', expiringOnly: '' },
  });

  const params: DocumentListParams = {
    page: list.page,
    pageSize: list.pageSize,
    sort: list.sort as DocumentListParams['sort'],
    order: list.order,
    kind: (list.filters.kind || undefined) as DocumentKind | undefined,
    entityId: isOperator ? undefined : list.filters.entityId || undefined,
    expiringOnly: list.filters.expiringOnly === 'true',
    search: list.search || undefined,
  };

  const listQuery = useQuery({
    queryKey: documentKeys.list(params),
    queryFn: () => documentsApi.list(params),
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: documentKeys.all });

  const [uploadOpen, setUploadOpen] = useState(false);
  const [replacing, setReplacing] = useState<DocumentRecord | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DocumentRecord | null>(null);
  const [form, setForm] = useState(BLANK_FORM);
  const [entityId, setEntityId] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const openUpload = (replace: DocumentRecord | null) => {
    setReplacing(replace);
    setForm(
      replace
        ? {
            kind: replace.kind,
            title: replace.title,
            reference: replace.reference ?? '',
            issuedAt: '',
            expiresAt: '',
          }
        : BLANK_FORM,
    );
    setEntityId(replace?.entityId ?? '');
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setUploadOpen(true);
  };

  const uploadMutation = useMutation({
    mutationFn: () =>
      documentsApi.upload({
        kind: form.kind,
        title: form.title.trim(),
        reference: form.reference.trim() || undefined,
        issuedAt: form.issuedAt || undefined,
        expiresAt: form.expiresAt || undefined,
        supersedesId: replacing?.id,
        entityId: isOperator ? undefined : entityId || undefined,
        file: file!,
      }),
    onSuccess: () => {
      refresh();
      setUploadOpen(false);
      toast.success(replacing ? 'Document replaced.' : 'Document filed.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't file that document.")),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => documentsApi.remove(id),
    onSuccess: () => {
      refresh();
      setPendingDelete(null);
      toast.success('Document deleted.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't remove that document.")),
  });

  const sweepMutation = useMutation({
    mutationFn: () => documentsApi.sweepExpiries(),
    onSuccess: (r) => {
      refresh();
      toast.success(
        r.alerted > 0
          ? `Expiry check complete. ${r.alerted} alert${r.alerted === 1 ? '' : 's'} sent.`
          : 'Expiry check complete. Nothing new to flag.',
      );
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't run the expiry check.")),
  });

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  async function handleDownload(doc: DocumentRecord) {
    setDownloadingId(doc.id);
    try {
      await documentsApi.download(doc);
    } catch (err) {
      toast.error(getErrorMessage(err, "We couldn't download that document."));
    } finally {
      setDownloadingId(null);
    }
  }

  const rows = listQuery.data?.data ?? [];

  const activeFilters: ActiveFilterChip[] = useMemo(() => {
    const chips: ActiveFilterChip[] = [];
    if (list.filters.kind) {
      chips.push({
        key: 'kind',
        label: DOCUMENT_KIND_LABELS[list.filters.kind as DocumentKind],
        onRemove: () => list.clearFilter('kind'),
      });
    }
    if (list.filters.entityId) {
      chips.push({
        key: 'entityId',
        label: 'Operator',
        onRemove: () => list.clearFilter('entityId'),
      });
    }
    if (list.filters.expiringOnly === 'true') {
      chips.push({
        key: 'expiringOnly',
        label: 'Expiring soon',
        onRemove: () => list.clearFilter('expiringOnly'),
      });
    }
    return chips;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.filters]);

  const columns: Column<DocumentRecord>[] = [
    {
      header: 'Document',
      cell: (d) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-gray-900">{d.title}</div>
          <div className="truncate text-xs text-gray-500">
            {joinMeta(
              DOCUMENT_KIND_LABELS[d.kind],
              d.reference,
              d.version > 1 ? `version ${d.version}` : null,
            )}
          </div>
        </div>
      ),
    },
    ...(isOperator
      ? []
      : [
          {
            header: 'Operator',
            cell: (d: DocumentRecord) => (
              <div className="min-w-0">
                <div className="truncate text-gray-700">{d.entity.name}</div>
                <div className="text-xs text-gray-500">{ENTITY_TYPE_LABELS[d.entity.type]}</div>
              </div>
            ),
          },
        ]),
    {
      header: 'Expires',
      sortKey: 'expiresAt',
      width: '13rem',
      cell: (d) =>
        d.expiresAt ? (
          <div className="min-w-0">
            <div className="text-gray-700">{formatDate(d.expiresAt)}</div>
            {d.expiry.stage && (
              <Badge tone={DOCUMENT_EXPIRY_TONE[d.expiry.stage]}>{expiryLabel(d)}</Badge>
            )}
          </div>
        ) : (
          <span className="text-gray-300">No expiry</span>
        ),
    },
    {
      header: 'File',
      width: '11rem',
      cell: (d) => (
        <span className="text-xs text-gray-500">
          {joinMeta(d.fileName, formatFileSize(d.sizeBytes))}
        </span>
      ),
    },
    {
      header: '',
      width: canUpload ? '13rem' : '8rem',
      align: 'right',
      cell: (d) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="secondary"
            size="sm"
            icon={Download}
            isLoading={downloadingId === d.id}
            onClick={() => void handleDownload(d)}
          >
            Open
          </Button>
          {canUpload && (
            <>
              <IconButton
                icon={RefreshCw}
                label={`Replace ${d.title}`}
                onClick={() => openUpload(d)}
              />
              <IconButton
                icon={Trash2}
                label={`Delete ${d.title}`}
                variant="danger"
                onClick={() => setPendingDelete(d)}
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
            isOperator
              ? 'Your licences and certificates on file with the Authority. Replace one before it expires to keep your record current.'
              : 'Licences and certificates on file for each operator, with expiry tracking.'
          }
        />
      }
      search={{
        value: list.search,
        onChange: list.setSearch,
        placeholder: 'Search by title or reference',
        label: 'Search documents',
      }}
      filters={
        <>
          <FilterField label="Type" width="md">
            <Select
              aria-label="Filter by document type"
              value={list.filters.kind}
              options={KIND_FILTER_OPTIONS}
              onChange={(kind) => list.setFilters({ kind })}
            />
          </FilterField>
          {!isOperator && (
            <FilterField label="Operator" width="lg">
              <Combobox
                aria-label="Filter by operator"
                emptyLabel="All operators"
                placeholder="Search operators…"
                source={entityPicker}
                value={list.filters.entityId}
                onChange={(id) => list.setFilters({ entityId: id })}
              />
            </FilterField>
          )}
          <FilterField label="Expiry" width="md">
            <Checkbox
              checked={list.filters.expiringOnly === 'true'}
              onChange={(checked) => list.setFilters({ expiringOnly: checked ? 'true' : '' })}
              label="Expiring soon only"
            />
          </FilterField>
        </>
      }
      activeFilters={activeFilters}
      onClearFilters={list.clearAll}
      actions={
        <div className="flex flex-wrap gap-2">
          {canSweep && (
            <Button
              variant="secondary"
              icon={BellRing}
              isLoading={sweepMutation.isPending}
              onClick={() => sweepMutation.mutate()}
            >
              Run expiry check
            </Button>
          )}
          {canUpload && (
            <Button icon={Plus} onClick={() => openUpload(null)}>
              File a document
            </Button>
          )}
        </div>
      }
      meta={listQuery.data?.meta}
      onPageChange={list.setPage}
      onPageSizeChange={list.setPageSize}
      refreshing={listQuery.isFetching && !listQuery.isLoading}
    >
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(d) => d.id}
        loading={listQuery.isLoading}
        refreshing={listQuery.isFetching && !listQuery.isLoading}
        error={listQuery.isError}
        onRetry={() => void listQuery.refetch()}
        sort={list.sort}
        order={list.order}
        onSortChange={list.setSort}
        emptyMessage={
          list.hasActiveFilters ? 'No documents match these filters.' : 'No documents on file yet.'
        }
      />

      <Modal
        open={uploadOpen}
        title={replacing ? `Replace ${replacing.title}` : 'File a document'}
        onClose={() => setUploadOpen(false)}
      >
        <div className="space-y-4">
          {replacing && (
            <p className="text-sm text-gray-500">
              The current version stays on file as history, and the new one becomes version{' '}
              {replacing.version + 1}.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type" htmlFor="doc-kind">
              <Select
                id="doc-kind"
                value={form.kind}
                options={KIND_OPTIONS}
                onChange={(kind) => setForm({ ...form, kind: kind as DocumentKind })}
              />
            </Field>
            <Field label="Reference" htmlFor="doc-ref" hint="The licence or certificate number.">
              <Input
                id="doc-ref"
                value={form.reference}
                onChange={(e) => setForm({ ...form, reference: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Title" htmlFor="doc-title">
            <Input
              id="doc-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Field>
          {!isOperator && !replacing && (
            <Field label="Operator" htmlFor="doc-entity">
              <Combobox
                aria-label="Choose the operator"
                emptyLabel="Choose an operator"
                placeholder="Search operators…"
                source={entityPicker}
                value={entityId}
                onChange={setEntityId}
              />
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Issued on" htmlFor="doc-issued">
              <Input
                id="doc-issued"
                type="date"
                value={form.issuedAt}
                onChange={(e) => setForm({ ...form, issuedAt: e.target.value })}
              />
            </Field>
            <Field
              label="Expires on"
              htmlFor="doc-expires"
              hint="Leave blank if it does not expire."
            >
              <Input
                id="doc-expires"
                type="date"
                value={form.expiresAt}
                onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
              />
            </Field>
          </div>
          <Field label="File" htmlFor="doc-file" hint={DOCUMENT_ACCEPT}>
            <input
              ref={fileInputRef}
              id="doc-file"
              type="file"
              accept={DOCUMENT_ACCEPT}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setUploadOpen(false)}>
              Cancel
            </Button>
            <Button
              icon={FileText}
              isLoading={uploadMutation.isPending}
              disabled={
                !file || form.title.trim().length < 2 || (!isOperator && !replacing && !entityId)
              }
              onClick={() => uploadMutation.mutate()}
            >
              {replacing ? 'Replace document' : 'File document'}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this document?"
        confirmLabel="Delete"
        tone="danger"
        isLoading={removeMutation.isPending}
        message={
          pendingDelete
            ? `${pendingDelete.title} will no longer appear on file. This cannot be undone.`
            : ''
        }
        onConfirm={() => pendingDelete && removeMutation.mutate(pendingDelete.id)}
        onClose={() => setPendingDelete(null)}
      />
    </ListShell>
  );
}
