import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cable, Plus, Trash2 } from 'lucide-react';
import { strings } from '../lib/strings';
import {
  Button,
  Card,
  Combobox,
  ConfirmDialog,
  Field,
  IconButton,
  Input,
  Modal,
  Select,
  useToast,
  type SelectOption,
} from './ui';
import { DataTable, type Column } from './DataTable';
import { geoApi, geoKeys, type FibreLinkInput, type FibreLinkListParams } from '../lib/geo.api';
import { sitePicker } from '../lib/pickers';
import { getErrorMessage } from '../lib/api';
import { joinMeta } from '../lib/format';
import {
  NETWORK_SITE_STATUS_LABELS,
  NETWORK_SITE_STATUSES,
  type FibreLink,
  type NetworkSiteStatus,
} from '../lib/types';

const STATUS_OPTIONS: SelectOption[] = NETWORK_SITE_STATUSES.map((s) => ({
  value: s,
  label: NETWORK_SITE_STATUS_LABELS[s],
}));

const BLANK = {
  linkReference: '',
  name: '',
  status: 'ACTIVE' as NetworkSiteStatus,
  lengthKm: '',
  capacityGbps: '',
};

/**
 * Fibre routes on the register (NCA, 15 September 2026).
 *
 * "Network Map: Display the complete fiber route."
 *
 * The register keeps nodes; this keeps the cable between them, which is what makes the map a
 * network rather than a scatter of points. Its own component rather than another section of the
 * map page, because it is a second table with a second form and the page was long already.
 *
 * Two things are stated on screen rather than left to be inferred. Route length is the operator's
 * figure and not the distance between the two ends — cable follows roads, so the two differ by
 * half again, and a reader who assumed it was calculated would trust a number nobody measured.
 * And a route with no survey behind it is labelled as such here as well as on the map, so the
 * difference survives being read as a table.
 */
export function FibreRouteRegister({
  entityId,
  status,
  canEdit,
}: {
  /** Authority only: whose register is being read. Operators are scoped to their own by the API. */
  entityId?: string;
  status?: NetworkSiteStatus;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [fromSiteId, setFromSiteId] = useState('');
  const [toSiteId, setToSiteId] = useState('');
  const [pendingDelete, setPendingDelete] = useState<FibreLink | null>(null);

  const params: FibreLinkListParams = {
    entityId,
    status,
    pageSize: 25,
    sort: 'name',
    order: 'asc',
  };
  const listQuery = useQuery({
    queryKey: geoKeys.links(params),
    queryFn: () => geoApi.listLinks(params),
  });
  const routes = listQuery.data?.data ?? [];

  const refresh = () => void qc.invalidateQueries({ queryKey: geoKeys.all });

  const reset = () => {
    setForm(BLANK);
    setFromSiteId('');
    setToSiteId('');
  };

  const create = useMutation({
    mutationFn: () => {
      const input: FibreLinkInput = {
        linkReference: form.linkReference.trim(),
        name: form.name.trim(),
        fromSiteId,
        toSiteId,
        status: form.status,
        lengthKm: form.lengthKm ? Number(form.lengthKm) : undefined,
        capacityGbps: form.capacityGbps ? Number(form.capacityGbps) : undefined,
      };
      return geoApi.createLink(input);
    },
    onSuccess: () => {
      refresh();
      setOpen(false);
      reset();
      toast.success('Route added to the register.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't add that route.")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => geoApi.removeLink(id),
    onSuccess: () => {
      refresh();
      setPendingDelete(null);
      toast.success('Route removed.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't remove that route.")),
  });

  const columns: Column<FibreLink>[] = [
    {
      header: strings.field.name,
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-gray-900">{r.name}</div>
          <div className="truncate text-xs text-gray-500">{r.linkReference}</div>
        </div>
      ),
    },
    {
      header: 'Between',
      cell: (r) => (
        <span className="text-gray-700">
          {r.fromSite.name} and {r.toSite.name}
        </span>
      ),
    },
    {
      header: 'Route',
      cell: (r) => (
        <div className="min-w-0">
          <div className="tabular-nums text-gray-700">
            {r.lengthKm === null ? '—' : `${Number(r.lengthKm)} km`}
          </div>
          {/*
            Said here as well as on the map. A table is where somebody checks a figure, and a
            length against a route nobody surveyed is an estimate of an estimate.
          */}
          <div className="text-xs text-gray-500">
            {r.path && r.path.length >= 2 ? 'Surveyed' : 'Straight line, not surveyed'}
          </div>
        </div>
      ),
    },
    {
      header: 'Capacity',
      align: 'right',
      cell: (r) => (
        <span className="tabular-nums text-gray-700">
          {r.capacityGbps === null ? '—' : `${r.capacityGbps} Gbit/s`}
        </span>
      ),
    },
    {
      header: strings.field.status,
      cell: (r) => <span className="text-gray-700">{NETWORK_SITE_STATUS_LABELS[r.status]}</span>,
    },
    ...(canEdit
      ? [
          {
            header: '',
            align: 'right' as const,
            cell: (r: FibreLink) => (
              <IconButton
                icon={Trash2}
                label={`Remove ${r.name}`}
                variant="danger"
                type="button"
                onClick={() => setPendingDelete(r)}
              />
            ),
          },
        ]
      : []),
  ];

  const ready =
    form.linkReference.trim().length > 0 &&
    form.name.trim().length > 1 &&
    fromSiteId.length > 0 &&
    toSiteId.length > 0 &&
    fromSiteId !== toSiteId;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Cable size={16} className="text-gray-500" aria-hidden />
            <h3 className="text-base font-semibold text-gray-900">Fibre routes</h3>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            The cable between two nodes on the register. A route with no survey behind it is drawn
            as a straight line, on the map and here.
          </p>
        </div>
        {canEdit && (
          <Button icon={Plus} size="sm" onClick={() => setOpen(true)}>
            Add a route
          </Button>
        )}
      </div>

      <div className="mt-4">
        <DataTable
          label="Fibre routes"
          columns={columns}
          rows={routes}
          rowKey={(r) => r.id}
          loading={listQuery.isLoading}
          error={listQuery.isError}
          onRetry={() => void listQuery.refetch()}
          emptyMessage="No fibre routes on the register yet."
        />
      </div>

      <Modal open={open} title="Add a fibre route" onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <div className="flex gap-4">
            <Field label="Reference" htmlFor="link-ref" hint="Your own reference for this route.">
              <Input
                id="link-ref"
                placeholder="e.g. JUB-WAU-01"
                value={form.linkReference}
                onChange={(e) => setForm({ ...form, linkReference: e.target.value })}
              />
            </Field>
            <Field label={strings.field.name} htmlFor="link-name">
              <Input
                id="link-name"
                placeholder="e.g. Juba to Wau backbone"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
          </div>

          <div className="flex gap-4">
            <Field label="From" htmlFor="link-from">
              <Combobox
                aria-label="Node the route starts at"
                emptyLabel="Choose a node"
                placeholder="Search the register…"
                source={sitePicker}
                value={fromSiteId}
                onChange={(id) => setFromSiteId(id)}
              />
            </Field>
            <Field
              label="To"
              htmlFor="link-to"
              error={
                fromSiteId && fromSiteId === toSiteId
                  ? 'A route has to join two different nodes.'
                  : undefined
              }
            >
              <Combobox
                aria-label="Node the route ends at"
                emptyLabel="Choose a node"
                placeholder="Search the register…"
                source={sitePicker}
                value={toSiteId}
                onChange={(id) => setToSiteId(id)}
              />
            </Field>
          </div>

          <div className="flex gap-4">
            <Field
              label="Route length"
              htmlFor="link-length"
              hint="Kilometres of cable, which is more than the distance between the two nodes."
            >
              <Input
                id="link-length"
                type="number"
                min={0}
                step="0.001"
                placeholder="e.g. 612.4"
                value={form.lengthKm}
                onChange={(e) => setForm({ ...form, lengthKm: e.target.value })}
              />
            </Field>
            <Field label="Capacity" htmlFor="link-capacity" hint="Lit capacity in Gbit/s.">
              <Input
                id="link-capacity"
                type="number"
                min={0}
                placeholder="e.g. 100"
                value={form.capacityGbps}
                onChange={(e) => setForm({ ...form, capacityGbps: e.target.value })}
              />
            </Field>
          </div>

          <Field label={strings.field.status} htmlFor="link-status">
            <Select
              aria-label="Route status"
              options={STATUS_OPTIONS}
              value={form.status}
              onChange={(v) => setForm({ ...form, status: v as NetworkSiteStatus })}
            />
          </Field>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {strings.action.cancel}
            </Button>
            <Button isLoading={create.isPending} disabled={!ready} onClick={() => create.mutate()}>
              Add the route
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Remove this route?"
        message={
          pendingDelete
            ? `${pendingDelete.name} comes off the register and off the map. ${joinMeta(
                pendingDelete.linkReference,
                `${pendingDelete.fromSite.name} to ${pendingDelete.toSite.name}`,
              )}`
            : ''
        }
        confirmLabel="Remove"
        tone="danger"
        isLoading={remove.isPending}
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete.id);
        }}
        onClose={() => setPendingDelete(null)}
      />
    </Card>
  );
}
