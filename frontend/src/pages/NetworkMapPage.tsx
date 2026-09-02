import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Plus, Radio, Trash2 } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Combobox,
  ConfirmDialog,
  EmptyState,
  Field,
  FilterField,
  IconButton,
  Input,
  Modal,
  Page,
  PageHeader,
  Select,
  Skeleton,
  useToast,
} from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import { NetworkMap } from '../components/NetworkMap';
import { MAP_KIND_COLOURS, MAP_KIND_LABELS } from '../components/map-legend';
import { geoApi, geoKeys, type NetworkSiteInput } from '../lib/geo.api';
import { entityPicker } from '../lib/pickers';
import { getErrorMessage } from '../lib/api';
import { joinMeta } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import {
  NETWORK_SITE_KINDS,
  NETWORK_SITE_KIND_LABELS,
  NETWORK_SITE_STATUSES,
  NETWORK_SITE_STATUS_LABELS,
  isOperatorRole,
  type MapPoint,
  type NetworkSite,
  type NetworkSiteKind,
  type NetworkSiteStatus,
} from '../lib/types';

const KIND_FILTER_OPTIONS = [
  { value: '', label: 'All site types' },
  ...NETWORK_SITE_KINDS.map((k) => ({ value: k, label: NETWORK_SITE_KIND_LABELS[k] })),
];
const KIND_OPTIONS = NETWORK_SITE_KINDS.map((k) => ({
  value: k,
  label: NETWORK_SITE_KIND_LABELS[k],
}));
const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'Any status' },
  ...NETWORK_SITE_STATUSES.map((s) => ({ value: s, label: NETWORK_SITE_STATUS_LABELS[s] })),
];
const STATUS_OPTIONS = NETWORK_SITE_STATUSES.map((s) => ({
  value: s,
  label: NETWORK_SITE_STATUS_LABELS[s],
}));

const BLANK = {
  siteReference: '',
  name: '',
  kind: 'BASE_STATION' as NetworkSiteKind,
  status: 'ACTIVE' as NetworkSiteStatus,
  latitude: '',
  longitude: '',
  location: '',
  technology: '',
  coverageM: '',
};

function coordinate(value: string | number): string {
  return Number(value).toFixed(6);
}

/**
 * The network map and the register behind it (Phase 2).
 *
 * An operator sees its own network; the Authority sees the sector and can narrow to one operator.
 * That scoping is enforced on the server — a mast register is a map of where a competitor has
 * invested, and it is not the kind of rule to leave to a filter on a screen.
 */
export function NetworkMapPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();

  const isOperator = !!user && isOperatorRole(user.role);
  const canFilterEntity = !isOperator;
  const canManage = isOperator || user?.role === 'ADMIN';

  const [entityId, setEntityId] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [includeAgents, setIncludeAgents] = useState(true);
  const [showCoverage, setShowCoverage] = useState(true);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [pendingDelete, setPendingDelete] = useState<NetworkSite | null>(null);

  const mapParams = {
    entityId: canFilterEntity && entityId ? entityId : undefined,
    kind: (kind || undefined) as NetworkSiteKind | undefined,
    status: (status || undefined) as NetworkSiteStatus | undefined,
    includeAgents,
  };
  const listParams = {
    entityId: mapParams.entityId,
    kind: mapParams.kind,
    status: mapParams.status,
    pageSize: 25,
    sort: 'name',
    order: 'asc' as const,
  };

  const mapQuery = useQuery({
    queryKey: geoKeys.map(mapParams),
    queryFn: () => geoApi.map(mapParams),
  });
  const listQuery = useQuery({
    queryKey: geoKeys.sites(listParams),
    queryFn: () => geoApi.list(listParams),
  });

  const points = useMemo(() => mapQuery.data?.points ?? [], [mapQuery.data]);
  const sites = listQuery.data?.data ?? [];

  // Only the layers actually on the map get a legend entry; a key to nothing is noise.
  const legend = useMemo(() => {
    const kinds = new Set<MapPoint['kind']>();
    for (const p of points) kinds.add(p.kind);
    return [...kinds];
  }, [points]);

  const refresh = () => void qc.invalidateQueries({ queryKey: geoKeys.all });

  const create = useMutation({
    mutationFn: () => {
      const input: NetworkSiteInput = {
        siteReference: form.siteReference.trim(),
        name: form.name.trim(),
        kind: form.kind,
        status: form.status,
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
        location: form.location.trim() || undefined,
        technology: form.technology.trim() || undefined,
        coverageM: form.coverageM ? Number(form.coverageM) : undefined,
      };
      return geoApi.create(input);
    },
    onSuccess: () => {
      refresh();
      setOpen(false);
      setForm(BLANK);
      toast.success('Site added to the register.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't add that site.")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => geoApi.remove(id),
    onSuccess: () => {
      refresh();
      setPendingDelete(null);
      toast.success('Site removed.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't remove that site.")),
  });

  const columns: Column<NetworkSite>[] = [
    {
      header: 'Site',
      cell: (s) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-gray-900">{s.name}</div>
          <div className="truncate text-xs text-gray-500">
            {joinMeta(s.siteReference, s.location)}
          </div>
        </div>
      ),
    },
    {
      header: 'Type',
      width: '10rem',
      cell: (s) => (
        <span className="inline-flex items-center gap-1.5 text-gray-700">
          <span
            className="size-2.5 rounded-full"
            style={{ backgroundColor: MAP_KIND_COLOURS[s.kind] }}
            aria-hidden
          />
          {NETWORK_SITE_KIND_LABELS[s.kind]}
        </span>
      ),
    },
    {
      header: 'Status',
      width: '8rem',
      cell: (s) => (
        <Badge tone={s.status === 'ACTIVE' ? 'success' : s.status === 'PLANNED' ? 'info' : 'gray'}>
          {NETWORK_SITE_STATUS_LABELS[s.status]}
        </Badge>
      ),
    },
    {
      header: 'Coordinates',
      width: '12rem',
      hideOnMobile: true,
      cell: (s) => (
        <span className="tabular-nums text-xs text-gray-500">
          {coordinate(s.latitude)}, {coordinate(s.longitude)}
        </span>
      ),
    },
  ];

  if (!isOperator) {
    columns.splice(1, 0, {
      header: 'Operator',
      width: '14rem',
      cell: (s) => <span className="text-gray-700">{s.entity.name}</span>,
    });
  }

  if (canManage) {
    columns.push({
      header: '',
      width: '4rem',
      align: 'right',
      cell: (s) => (
        <IconButton
          icon={Trash2}
          label={`Remove ${s.name}`}
          variant="danger"
          onClick={() => setPendingDelete(s)}
        />
      ),
    });
  }

  return (
    <Page>
      <div className="space-y-6">
        <PageHeader
          title="Network map"
          description={
            isOperator
              ? 'Your masts, fibre nodes and agent locations. Only you and the Authority can see them.'
              : 'Where the sector has built: masts, fibre nodes and agent locations across every licensed operator.'
          }
          actions={
            canManage && (
              <Button icon={Plus} onClick={() => setOpen(true)}>
                Add a site
              </Button>
            )
          }
        />

        <div className="flex flex-wrap items-end gap-4">
          {canFilterEntity && (
            <FilterField label="Operator" width="lg">
              <Combobox
                aria-label="Filter by operator"
                emptyLabel="All operators"
                placeholder="Search operators…"
                source={entityPicker}
                value={entityId}
                onChange={setEntityId}
              />
            </FilterField>
          )}
          <FilterField label="Site type" width="md">
            <Select
              aria-label="Filter by site type"
              options={KIND_FILTER_OPTIONS}
              value={kind}
              onChange={setKind}
            />
          </FilterField>
          <FilterField label="Status" width="md">
            <Select
              aria-label="Filter by status"
              options={STATUS_FILTER_OPTIONS}
              value={status}
              onChange={setStatus}
            />
          </FilterField>
          <div className="flex flex-col gap-1.5 pb-1">
            <Checkbox checked={includeAgents} onChange={setIncludeAgents} label="Show agents" />
            <Checkbox
              checked={showCoverage}
              onChange={setShowCoverage}
              label="Show coverage rings"
            />
          </div>
        </div>

        <Card>
          {mapQuery.isLoading ? (
            <Skeleton className="h-[28rem] w-full" />
          ) : points.length === 0 ? (
            <EmptyState
              icon={MapPin}
              message="Nothing to map yet. Add a site to the register, or record coordinates against your agents."
            />
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-gray-600">
                {legend.map((k) => (
                  <span key={k} className="inline-flex items-center gap-1.5">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: MAP_KIND_COLOURS[k] }}
                      aria-hidden
                    />
                    {MAP_KIND_LABELS[k]}
                  </span>
                ))}
                <span className="ml-auto text-gray-500">
                  {joinMeta(
                    `${mapQuery.data?.counts.sites ?? 0} sites`,
                    includeAgents && `${mapQuery.data?.counts.agents ?? 0} agents`,
                  )}
                </span>
              </div>
              <NetworkMap
                points={points}
                showCoverage={showCoverage}
                listedIn={
                  includeAgents
                    ? 'the site register below and the agent register'
                    : 'the site register below'
                }
              />
              {mapQuery.data?.truncated && (
                <div className="mt-3">
                  <Alert tone="info">
                    There are more locations than the map will draw at once. Narrow the filters to
                    see the rest.
                  </Alert>
                </div>
              )}
            </>
          )}
        </Card>

        <Card>
          <div className="flex items-center gap-2">
            <Radio size={16} className="text-gray-500" aria-hidden />
            <h3 className="text-base font-semibold text-gray-900">Site register</h3>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            The structured record behind the map. Coverage and fibre maps attached to a return stay
            with that return; these are the points the Authority can count and compare.
          </p>
          <div className="mt-4">
            <DataTable
              columns={columns}
              rows={sites}
              rowKey={(s) => s.id}
              loading={listQuery.isLoading}
              error={listQuery.isError}
              onRetry={() => void listQuery.refetch()}
              emptyMessage="No sites match these filters."
            />
          </div>
        </Card>
      </div>

      <Modal open={open} title="Add a site" onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <div className="flex gap-4">
            <Field label="Reference" htmlFor="site-ref" hint="Your own reference for this site.">
              <Input
                id="site-ref"
                value={form.siteReference}
                onChange={(e) => setForm({ ...form, siteReference: e.target.value })}
              />
            </Field>
            <Field label="Name" htmlFor="site-name">
              <Input
                id="site-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
          </div>
          <div className="flex gap-4">
            <Field label="Type" htmlFor="site-kind">
              <Select
                aria-label="Site type"
                options={KIND_OPTIONS}
                value={form.kind}
                onChange={(k) => setForm({ ...form, kind: k as NetworkSiteKind })}
              />
            </Field>
            <Field label="Status" htmlFor="site-status">
              <Select
                aria-label="Site status"
                options={STATUS_OPTIONS}
                value={form.status}
                onChange={(s) => setForm({ ...form, status: s as NetworkSiteStatus })}
              />
            </Field>
          </div>
          <div className="flex gap-4">
            <Field label="Latitude" htmlFor="site-lat" hint="Decimal degrees, e.g. 4.859363.">
              <Input
                id="site-lat"
                type="number"
                step="0.000001"
                value={form.latitude}
                onChange={(e) => setForm({ ...form, latitude: e.target.value })}
              />
            </Field>
            <Field label="Longitude" htmlFor="site-lng" hint="Decimal degrees, e.g. 31.571251.">
              <Input
                id="site-lng"
                type="number"
                step="0.000001"
                value={form.longitude}
                onChange={(e) => setForm({ ...form, longitude: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Place" htmlFor="site-place" hint="Optional, e.g. the town or district.">
            <Input
              id="site-place"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
            />
          </Field>
          <div className="flex gap-4">
            <Field label="Technology" htmlFor="site-tech" hint="Optional, e.g. 4G.">
              <Input
                id="site-tech"
                value={form.technology}
                onChange={(e) => setForm({ ...form, technology: e.target.value })}
              />
            </Field>
            <Field
              label="Coverage radius (m)"
              htmlFor="site-cov"
              hint="Optional. Drawn as a ring on the map."
            >
              <Input
                id="site-cov"
                type="number"
                min="0"
                value={form.coverageM}
                onChange={(e) => setForm({ ...form, coverageM: e.target.value })}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              isLoading={create.isPending}
              disabled={
                form.siteReference.trim().length < 1 ||
                form.name.trim().length < 2 ||
                form.latitude === '' ||
                form.longitude === ''
              }
              onClick={() => create.mutate()}
            >
              Add site
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Remove this site?"
        confirmLabel="Remove"
        tone="danger"
        isLoading={remove.isPending}
        message={
          pendingDelete
            ? `"${pendingDelete.name}" will come off the map and the register. If it is simply out of service, set its status to retired instead.`
            : ''
        }
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete.id)}
        onClose={() => setPendingDelete(null)}
      />
    </Page>
  );
}
