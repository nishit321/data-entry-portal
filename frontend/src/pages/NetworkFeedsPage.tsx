import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Antenna, FileSignature, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
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
  Tabs,
  Textarea,
  useToast,
} from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import { feedsApi, feedsKeys, type AgreementInput, type FeedInput } from '../lib/feeds.api';
import { entityPicker } from '../lib/pickers';
import { getErrorMessage } from '../lib/api';
import { formatDate, formatDateTime, joinMeta } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import {
  AGREEMENT_STATUSES,
  AGREEMENT_STATUS_LABELS,
  FEED_FREQUENCIES,
  FEED_FREQUENCY_LABELS,
  FEED_RUN_OUTCOME_LABELS,
  WEEKDAY_LABELS,
  isOperatorRole,
  type AgreementStatus,
  type DataSharingAgreement,
  type FeedFrequency,
  type FeedMetric,
  type FeedRunOutcome,
  type NetworkFeed,
} from '../lib/types';

const STATUS_OPTIONS = AGREEMENT_STATUSES.map((s) => ({
  value: s,
  label: AGREEMENT_STATUS_LABELS[s],
}));
const FREQUENCY_OPTIONS = FEED_FREQUENCIES.map((f) => ({
  value: f,
  label: FEED_FREQUENCY_LABELS[f],
}));
const WEEKDAY_OPTIONS = WEEKDAY_LABELS.map((label, i) => ({ value: String(i + 1), label }));
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: String(i),
  label: `${String(i).padStart(2, '0')}:00`,
}));

const BLANK_AGREEMENT = {
  entityId: '',
  reference: '',
  title: '',
  scope: '',
  status: 'DRAFT' as AgreementStatus,
  signedAt: '',
  startsAt: '',
  endsAt: '',
};

const BLANK_FEED = {
  agreementId: '',
  name: '',
  url: '',
  frequency: 'DAILY' as FeedFrequency,
  hour: '3',
  dayOfWeek: '1',
  authToken: '',
};

const OUTCOME_TONE: Record<FeedRunOutcome, 'success' | 'danger' | 'gray'> = {
  SUCCEEDED: 'success',
  FAILED: 'danger',
  SKIPPED: 'gray',
};

/** How often a feed runs, in the words it was set up with. */
function timetable(feed: NetworkFeed): string {
  const time = `${String(feed.hour).padStart(2, '0')}:00`;
  if (feed.frequency === 'HOURLY') return 'Every hour';
  if (feed.frequency === 'WEEKLY') {
    return `Every ${WEEKDAY_LABELS[feed.dayOfWeek - 1] ?? 'Monday'} at ${time}`;
  }
  return `Every day at ${time}`;
}

/** Whether an agreement is in force right now, judged the same way the server judges it. */
function inForce(agreement: { status: AgreementStatus; startsAt: string; endsAt: string | null }) {
  if (agreement.status !== 'ACTIVE') return false;
  const now = Date.now();
  if (new Date(agreement.startsAt).getTime() > now) return false;
  if (agreement.endsAt && new Date(agreement.endsAt).getTime() < now) return false;
  return true;
}

/**
 * Data-sharing agreements and the feeds that run under them (Q10, Phase 3).
 *
 * An operator can see what NCA is collecting from its systems and how it has been going; setting
 * one up is the Authority's job, because the agreement is the Authority's instrument.
 */
export function NetworkFeedsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();

  const isOperator = !!user && isOperatorRole(user.role);
  const canManage = user?.role === 'ADMIN' || user?.role === 'SUPERVISOR';

  const [tab, setTab] = useState<'feeds' | 'agreements' | 'metrics'>('feeds');
  const [metricKey, setMetricKey] = useState('');
  const [agreementOpen, setAgreementOpen] = useState(false);
  const [feedOpen, setFeedOpen] = useState(false);
  const [agreementForm, setAgreementForm] = useState(BLANK_AGREEMENT);
  const [feedForm, setFeedForm] = useState(BLANK_FEED);
  const [pendingFeed, setPendingFeed] = useState<NetworkFeed | null>(null);
  const [pendingAgreement, setPendingAgreement] = useState<DataSharingAgreement | null>(null);
  const [openRuns, setOpenRuns] = useState<string | null>(null);

  const agreementsQuery = useQuery({
    queryKey: feedsKeys.agreements,
    queryFn: () => feedsApi.listAgreements(),
  });
  const feedsQuery = useQuery({ queryKey: feedsKeys.list, queryFn: () => feedsApi.list() });
  const runsQuery = useQuery({
    queryKey: feedsKeys.runs(openRuns ?? ''),
    queryFn: () => feedsApi.runs(openRuns!),
    enabled: openRuns !== null,
  });

  const metricsQuery = useQuery({
    queryKey: feedsKeys.metrics({ key: metricKey || undefined }),
    queryFn: () => feedsApi.metrics({ key: metricKey || undefined, limit: 200 }),
    enabled: tab === 'metrics',
  });

  const agreements = agreementsQuery.data ?? [];
  const feeds = feedsQuery.data ?? [];
  const metrics = metricsQuery.data?.metrics ?? [];
  const metricKeys = metricsQuery.data?.keys ?? [];

  const refresh = () => void qc.invalidateQueries({ queryKey: feedsKeys.all });

  const createAgreement = useMutation({
    mutationFn: () => {
      const input: AgreementInput = {
        entityId: agreementForm.entityId,
        reference: agreementForm.reference.trim(),
        title: agreementForm.title.trim(),
        scope: agreementForm.scope.trim() || undefined,
        status: agreementForm.status,
        signedAt: agreementForm.signedAt || undefined,
        startsAt: agreementForm.startsAt,
        endsAt: agreementForm.endsAt || undefined,
      };
      return feedsApi.createAgreement(input);
    },
    onSuccess: () => {
      refresh();
      setAgreementOpen(false);
      setAgreementForm(BLANK_AGREEMENT);
      toast.success('Agreement recorded.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't record that agreement.")),
  });

  const createFeed = useMutation({
    mutationFn: () => {
      const input: FeedInput = {
        agreementId: feedForm.agreementId,
        name: feedForm.name.trim(),
        url: feedForm.url.trim(),
        frequency: feedForm.frequency,
        hour: Number(feedForm.hour),
        dayOfWeek: Number(feedForm.dayOfWeek),
        authToken: feedForm.authToken.trim() || undefined,
      };
      return feedsApi.create(input);
    },
    onSuccess: () => {
      refresh();
      setFeedOpen(false);
      setFeedForm(BLANK_FEED);
      toast.success('Feed added.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't add that feed.")),
  });

  const runNow = useMutation({
    mutationFn: (id: string) => feedsApi.run(id),
    onSuccess: (r) => {
      refresh();
      if (r.outcome === 'SUCCEEDED') toast.success(`Collected ${r.metricCount} metrics.`);
      else toast.error(r.message ?? 'Nothing was collected.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't run that feed.")),
  });

  const togglePaused = useMutation({
    mutationFn: (feed: NetworkFeed) => feedsApi.update(feed.id, { isEnabled: !feed.isEnabled }),
    onSuccess: () => {
      refresh();
      toast.success('Updated.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't change that.")),
  });

  const removeFeed = useMutation({
    mutationFn: (id: string) => feedsApi.remove(id),
    onSuccess: () => {
      refresh();
      setPendingFeed(null);
      toast.success('Feed removed.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't remove that feed.")),
  });

  const removeAgreement = useMutation({
    mutationFn: (id: string) => feedsApi.removeAgreement(id),
    onSuccess: () => {
      refresh();
      setPendingAgreement(null);
      toast.success('Agreement removed.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't remove that agreement.")),
  });

  const metricColumns: Column<FeedMetric>[] = [
    { header: 'Measurement', cell: (m) => m.key, width: '26%' },
    {
      header: 'Value',
      align: 'right',
      width: '16%',
      cell: (m) => (
        <span className="tabular-nums text-gray-900">
          {Number(m.value).toLocaleString('en-GB', { maximumFractionDigits: 4 })}
          {m.unit ? ` ${m.unit}` : ''}
        </span>
      ),
    },
    {
      header: 'Measured',
      width: '20%',
      cell: (m) => <span className="text-gray-600">{formatDateTime(m.measuredAt)}</span>,
    },
    { header: 'Feed', cell: (m) => m.feedRun.feed.name, hideOnMobile: true },
  ];

  if (!isOperator) {
    metricColumns.splice(1, 0, {
      header: 'Operator',
      width: '18%',
      cell: (m) => m.entity.name,
    });
  }

  const agreementOptions = agreements.map((a) => ({
    value: a.id,
    label: joinMeta(a.reference, a.entity.name),
  }));

  return (
    <Page>
      <div className="space-y-6">
        <PageHeader
          title="Automated feeds"
          description={
            isOperator
              ? 'What the Authority collects automatically from your systems, and the agreement each collection runs under.'
              : 'Metrics collected automatically from operator systems. Every feed runs under a signed data-sharing agreement, checked on each collection.'
          }
          actions={
            canManage && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  icon={FileSignature}
                  onClick={() => setAgreementOpen(true)}
                >
                  Record an agreement
                </Button>
                <Button
                  icon={Plus}
                  disabled={agreements.length === 0}
                  onClick={() => setFeedOpen(true)}
                >
                  Add a feed
                </Button>
              </div>
            )
          }
        />

        <Tabs
          aria-label="Feeds view"
          tabs={[
            { id: 'feeds', label: 'Feeds', count: feeds.length || undefined },
            { id: 'agreements', label: 'Agreements', count: agreements.length || undefined },
            { id: 'metrics', label: 'Collected' },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === 'feeds' &&
          (feedsQuery.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : feeds.length === 0 ? (
            <Card>
              <EmptyState
                icon={Antenna}
                message="No automated feeds are set up. Record a data-sharing agreement first, then add a feed under it."
              />
            </Card>
          ) : (
            <div className="space-y-4">
              {feeds.map((feed) => (
                <Card key={feed.id}>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-gray-900">{feed.name}</h3>
                        <Badge tone={feed.isEnabled ? 'success' : 'gray'}>
                          {feed.isEnabled ? 'Collecting' : 'Paused'}
                        </Badge>
                        {feed.lastOutcome && (
                          <Badge tone={OUTCOME_TONE[feed.lastOutcome]}>
                            {FEED_RUN_OUTCOME_LABELS[feed.lastOutcome]}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 truncate text-sm text-gray-600">{feed.url}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        {joinMeta(
                          timetable(feed),
                          !isOperator && feed.agreement.entity.name,
                          feed.agreement.reference,
                          feed.lastRunAt
                            ? `last tried ${formatDateTime(feed.lastRunAt)}`
                            : 'not tried yet',
                        )}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setOpenRuns(openRuns === feed.id ? null : feed.id)}
                      >
                        {openRuns === feed.id ? 'Hide history' : 'History'}
                      </Button>
                      {canManage && (
                        <>
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={Play}
                            isLoading={runNow.isPending && runNow.variables === feed.id}
                            onClick={() => runNow.mutate(feed.id)}
                          >
                            Collect now
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={RefreshCw}
                            onClick={() => togglePaused.mutate(feed)}
                          >
                            {feed.isEnabled ? 'Pause' : 'Resume'}
                          </Button>
                          <IconButton
                            icon={Trash2}
                            label={`Remove ${feed.name}`}
                            variant="danger"
                            onClick={() => setPendingFeed(feed)}
                          />
                        </>
                      )}
                    </div>
                  </div>

                  {!inForce(feed.agreement) && (
                    <div className="mt-3">
                      <Alert tone="warning">
                        The agreement behind this feed is not in force, so nothing is being
                        collected.
                      </Alert>
                    </div>
                  )}
                  {feed.lastError && (
                    <p className="mt-3 text-sm text-danger-700">{feed.lastError}</p>
                  )}

                  {openRuns === feed.id && (
                    <div className="mt-4 border-t border-gray-100 pt-4">
                      {runsQuery.isLoading ? (
                        <Skeleton className="h-24 w-full" />
                      ) : (runsQuery.data ?? []).length === 0 ? (
                        <EmptyState message="No collections have been attempted yet." />
                      ) : (
                        <ul className="divide-y divide-gray-100">
                          {(runsQuery.data ?? []).map((run) => (
                            <li key={run.id} className="flex items-center gap-3 py-2">
                              <Badge tone={OUTCOME_TONE[run.outcome]}>
                                {FEED_RUN_OUTCOME_LABELS[run.outcome]}
                              </Badge>
                              <span className="text-xs text-gray-500">
                                {formatDateTime(run.startedAt)}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-xs text-gray-500">
                                {run.message ?? `${run.metricCount} metrics`}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          ))}

        {tab === 'agreements' &&
          (agreementsQuery.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : agreements.length === 0 ? (
            <Card>
              <EmptyState
                icon={FileSignature}
                message="No data-sharing agreements are on record. A feed cannot collect anything without one."
              />
            </Card>
          ) : (
            <Card>
              <ul className="divide-y divide-gray-100">
                {agreements.map((agreement) => (
                  <li key={agreement.id} className="flex items-start gap-4 py-3">
                    <Badge tone={inForce(agreement) ? 'success' : 'gray'}>
                      {AGREEMENT_STATUS_LABELS[agreement.status]}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {agreement.title}
                      </p>
                      <p className="truncate text-xs text-gray-500">
                        {joinMeta(
                          agreement.reference,
                          !isOperator && agreement.entity.name,
                          `from ${formatDate(agreement.startsAt)}`,
                          agreement.endsAt ? `to ${formatDate(agreement.endsAt)}` : 'open-ended',
                          `${agreement._count.feeds} ${agreement._count.feeds === 1 ? 'feed' : 'feeds'}`,
                        )}
                      </p>
                      {agreement.scope && (
                        <p className="mt-1 text-xs text-gray-500">{agreement.scope}</p>
                      )}
                    </div>
                    {canManage && (
                      <IconButton
                        icon={Trash2}
                        label={`Remove ${agreement.reference}`}
                        variant="danger"
                        onClick={() => setPendingAgreement(agreement)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
      </div>

      {tab === 'metrics' && (
        <div className="space-y-4">
          <Alert tone="info">
            These are figures an operator agreed to share under a data-sharing agreement. They are
            not filed returns: nothing here has been signed or reviewed, and nothing here enters the
            approval workflow.
          </Alert>

          {metricKeys.length > 0 && (
            <div className="flex flex-wrap gap-4">
              <FilterField label="Measurement" width="lg">
                <Select
                  aria-label="Filter by measurement"
                  options={[
                    { value: '', label: 'All measurements' },
                    ...metricKeys.map((k) => ({
                      value: k.key,
                      label: `${k.key} (${k.count})`,
                    })),
                  ]}
                  value={metricKey}
                  onChange={setMetricKey}
                />
              </FilterField>
            </div>
          )}

          <Card>
            {metricsQuery.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : metrics.length === 0 ? (
              <EmptyState
                icon={Antenna}
                message="Nothing has been collected yet. Metrics appear here after a feed runs successfully."
              />
            ) : (
              <DataTable
                columns={metricColumns}
                rows={metrics}
                rowKey={(m) => m.id}
                emptyMessage="Nothing matches this filter."
              />
            )}
          </Card>
        </div>
      )}

      <Modal
        open={agreementOpen}
        title="Record a data-sharing agreement"
        onClose={() => setAgreementOpen(false)}
      >
        <div className="space-y-4">
          <Field label="Operator" htmlFor="ag-entity">
            <Combobox
              aria-label="Operator the agreement is with"
              emptyLabel="Choose an operator"
              placeholder="Search operators…"
              source={entityPicker}
              value={agreementForm.entityId}
              onChange={(entityId) => setAgreementForm({ ...agreementForm, entityId })}
            />
          </Field>
          <Field
            label="Reference"
            htmlFor="ag-ref"
            hint="The Authority's own reference for the signed instrument."
          >
            <Input
              id="ag-ref"
              value={agreementForm.reference}
              onChange={(e) => setAgreementForm({ ...agreementForm, reference: e.target.value })}
            />
          </Field>
          <Field label="Title" htmlFor="ag-title">
            <Input
              id="ag-title"
              value={agreementForm.title}
              onChange={(e) => setAgreementForm({ ...agreementForm, title: e.target.value })}
            />
          </Field>
          <Field
            label="What may be collected"
            htmlFor="ag-scope"
            hint="Optional. In the agreement's own words."
          >
            <Textarea
              id="ag-scope"
              rows={2}
              autoGrow
              value={agreementForm.scope}
              onChange={(e) => setAgreementForm({ ...agreementForm, scope: e.target.value })}
            />
          </Field>
          <Field
            label="Status"
            htmlFor="ag-status"
            hint="Nothing is collected until this is in force."
          >
            <Select
              aria-label="Agreement status"
              options={STATUS_OPTIONS}
              value={agreementForm.status}
              onChange={(status) =>
                setAgreementForm({ ...agreementForm, status: status as AgreementStatus })
              }
            />
          </Field>
          <div className="flex gap-4">
            <Field label="In force from" htmlFor="ag-from">
              <Input
                id="ag-from"
                type="date"
                value={agreementForm.startsAt}
                onChange={(e) => setAgreementForm({ ...agreementForm, startsAt: e.target.value })}
              />
            </Field>
            <Field label="Until" htmlFor="ag-to" hint="Leave blank if open-ended.">
              <Input
                id="ag-to"
                type="date"
                value={agreementForm.endsAt}
                onChange={(e) => setAgreementForm({ ...agreementForm, endsAt: e.target.value })}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAgreementOpen(false)}>
              Cancel
            </Button>
            <Button
              isLoading={createAgreement.isPending}
              disabled={
                !agreementForm.entityId ||
                agreementForm.reference.trim().length < 2 ||
                agreementForm.title.trim().length < 2 ||
                !agreementForm.startsAt
              }
              onClick={() => createAgreement.mutate()}
            >
              Record it
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={feedOpen} title="Add a feed" onClose={() => setFeedOpen(false)}>
        <div className="space-y-4">
          <Field
            label="Under which agreement"
            htmlFor="fd-agreement"
            hint="A feed collects nothing unless its agreement is in force."
          >
            <Select
              aria-label="Agreement this feed runs under"
              options={agreementOptions}
              value={feedForm.agreementId}
              onChange={(agreementId) => setFeedForm({ ...feedForm, agreementId })}
              placeholder="Choose an agreement"
            />
          </Field>
          <Field label="Name" htmlFor="fd-name">
            <Input
              id="fd-name"
              value={feedForm.name}
              onChange={(e) => setFeedForm({ ...feedForm, name: e.target.value })}
            />
          </Field>
          <Field
            label="Address"
            htmlFor="fd-url"
            hint="Must be https on the standard port, and must not be an address on an internal network."
          >
            <Input
              id="fd-url"
              placeholder="https://feeds.operator.example/metrics"
              value={feedForm.url}
              onChange={(e) => setFeedForm({ ...feedForm, url: e.target.value })}
            />
          </Field>
          <Field label="How often" htmlFor="fd-freq">
            <Select
              aria-label="How often to collect"
              options={FREQUENCY_OPTIONS}
              value={feedForm.frequency}
              onChange={(frequency) =>
                setFeedForm({ ...feedForm, frequency: frequency as FeedFrequency })
              }
            />
          </Field>
          {feedForm.frequency !== 'HOURLY' && (
            <div className="flex gap-4">
              {feedForm.frequency === 'WEEKLY' && (
                <Field label="Day" htmlFor="fd-day">
                  <Select
                    aria-label="Day to collect"
                    options={WEEKDAY_OPTIONS}
                    value={feedForm.dayOfWeek}
                    onChange={(dayOfWeek) => setFeedForm({ ...feedForm, dayOfWeek })}
                  />
                </Field>
              )}
              <Field label="Time" htmlFor="fd-hour">
                <Select
                  aria-label="Time to collect"
                  options={HOUR_OPTIONS}
                  value={feedForm.hour}
                  onChange={(hour) => setFeedForm({ ...feedForm, hour })}
                />
              </Field>
            </div>
          )}
          <Field
            label="Access token"
            htmlFor="fd-token"
            hint="Optional. Sent as a bearer token. Stored and never shown again."
          >
            <Input
              id="fd-token"
              type="password"
              value={feedForm.authToken}
              onChange={(e) => setFeedForm({ ...feedForm, authToken: e.target.value })}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setFeedOpen(false)}>
              Cancel
            </Button>
            <Button
              isLoading={createFeed.isPending}
              disabled={
                !feedForm.agreementId ||
                feedForm.name.trim().length < 2 ||
                feedForm.url.trim().length < 8
              }
              onClick={() => createFeed.mutate()}
            >
              Add feed
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingFeed !== null}
        title="Remove this feed?"
        confirmLabel="Remove"
        tone="danger"
        isLoading={removeFeed.isPending}
        message="Collection stops. Metrics already collected are kept."
        onConfirm={() => pendingFeed && removeFeed.mutate(pendingFeed.id)}
        onClose={() => setPendingFeed(null)}
      />

      <ConfirmDialog
        open={pendingAgreement !== null}
        title="Remove this agreement?"
        confirmLabel="Remove"
        tone="danger"
        isLoading={removeAgreement.isPending}
        message="Any feeds under it must be removed first. Metrics already collected are kept."
        onConfirm={() => pendingAgreement && removeAgreement.mutate(pendingAgreement.id)}
        onClose={() => setPendingAgreement(null)}
      />
    </Page>
  );
}
