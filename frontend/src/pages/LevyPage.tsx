import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Coins, Download, FileText, Percent, Plus, Trash2, Users } from 'lucide-react';
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
  Skeleton,
  StatCard,
  useToast,
} from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import { levyApi, levyKeys, type LevyAssessmentParams } from '../lib/levy.api';
import { exportsApi } from '../lib/exports.api';
import { periodPicker } from '../lib/pickers';
import { getErrorMessage } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { formatDate, formatSsp, joinMeta } from '../lib/format';
import {
  ENTITY_TYPE_LABELS,
  isOperatorRole,
  type LevyAssessmentRow,
  type LevyRate,
} from '../lib/types';

function ratePercentOf(rate: { ratePercent: string | number }): number {
  return Number(rate.ratePercent);
}

export function LevyPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();

  const isOperator = !!user && isOperatorRole(user.role);
  const isAdmin = user?.role === 'ADMIN';
  // The rate schedule is Authority-internal; operators see only their own assessment.
  const canSeeRates = !isOperator;

  const [periodId, setPeriodId] = useState('');
  const params: LevyAssessmentParams = { periodId: periodId || undefined };

  const assessmentQuery = useQuery({
    queryKey: levyKeys.assessments(params),
    queryFn: () => levyApi.assessments(params),
  });
  const ratesQuery = useQuery({
    queryKey: levyKeys.rates,
    queryFn: () => levyApi.listRates(),
    enabled: canSeeRates,
  });

  const [rateOpen, setRateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<LevyRate | null>(null);
  const [form, setForm] = useState({
    ratePercent: '',
    effectiveFrom: '',
    effectiveTo: '',
    label: '',
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: levyKeys.all });

  const createRate = useMutation({
    mutationFn: () =>
      levyApi.createRate({
        ratePercent: Number(form.ratePercent),
        effectiveFrom: form.effectiveFrom,
        effectiveTo: form.effectiveTo || undefined,
        label: form.label.trim() || undefined,
      }),
    onSuccess: () => {
      refresh();
      setRateOpen(false);
      setForm({ ratePercent: '', effectiveFrom: '', effectiveTo: '', label: '' });
      toast.success('Levy rate added.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't save the levy rate.")),
  });

  const removeRate = useMutation({
    mutationFn: (id: string) => levyApi.removeRate(id),
    onSuccess: () => {
      refresh();
      setPendingDelete(null);
      toast.success('Levy rate deleted.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't remove the levy rate.")),
  });

  const a = assessmentQuery.data;

  const exportWorkbook = useMutation({
    mutationFn: () => exportsApi.levyWorkbook(params),
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't build the export.")),
  });
  const exportPdf = useMutation({
    mutationFn: () => exportsApi.levyPdf(params),
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't build the document.")),
  });

  const columns: Column<LevyAssessmentRow>[] = [
    {
      header: 'Operator',
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-gray-900">{r.entity.name}</div>
          <div className="text-xs text-gray-500">{ENTITY_TYPE_LABELS[r.entity.type]}</div>
        </div>
      ),
    },
    {
      header: 'Assessable revenue',
      align: 'right',
      cell: (r) => (
        <span className="tabular-nums text-gray-700">{formatSsp(r.assessableRevenue)}</span>
      ),
    },
    {
      header: 'Levy due',
      align: 'right',
      cell: (r) => (
        <span className="tabular-nums font-medium text-gray-900">{formatSsp(r.levyDue)}</span>
      ),
    },
  ];

  return (
    <Page>
      <div className="space-y-6">
        <PageHeader
          title="Revenue and levy"
          description={
            isOperator
              ? 'The levy assessed on the revenue in your approved return.'
              : 'Levy assessed on approved operator revenue, at the rate in force for the reporting period.'
          }
          actions={
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                icon={FileText}
                isLoading={exportPdf.isPending}
                onClick={() => exportPdf.mutate()}
              >
                Download PDF
              </Button>
              <Button
                variant="secondary"
                icon={Download}
                isLoading={exportWorkbook.isPending}
                onClick={() => exportWorkbook.mutate()}
              >
                Export to Excel
              </Button>
              {isAdmin && (
                <Button icon={Plus} onClick={() => setRateOpen(true)}>
                  Add a rate
                </Button>
              )}
            </div>
          }
        />

        <div className="flex flex-wrap gap-4">
          <FilterField label="Reporting period" width="xl">
            <Combobox
              aria-label="Choose a reporting period"
              emptyLabel="Most recent assessed period"
              placeholder="Search periods…"
              source={periodPicker}
              value={periodId}
              onChange={setPeriodId}
            />
          </FilterField>
        </div>

        {assessmentQuery.isLoading || !a ? (
          <div className="grid gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : a.period === null ? (
          <Card>
            <EmptyState
              icon={Coins}
              message="Nothing to assess yet. A levy is calculated once a return has been approved."
            />
          </Card>
        ) : (
          <>
            {!a.levyBasisConfigured && (
              <Alert tone="warning">
                <p className="font-medium">No revenue field is marked as the levy basis.</p>
                <p className="mt-1 text-sm">
                  Open the questionnaire and mark the annual revenue field as the levy basis, then
                  the assessment will pick it up.
                </p>
              </Alert>
            )}
            {a.rate === null && (
              <Alert tone="warning">
                <p className="font-medium">No levy rate is configured for this period.</p>
                <p className="mt-1 text-sm">
                  Revenue is shown below, but the levy cannot be calculated until a rate covering{' '}
                  {formatDate(a.period.dueDate)} is added.
                </p>
              </Alert>
            )}

            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard
                label="Assessable revenue"
                value={formatSsp(a.totals.totalRevenue)}
                icon={Coins}
                tone="brand"
              />
              <StatCard
                label="Levy due"
                value={formatSsp(a.totals.totalLevyDue)}
                icon={Percent}
                tone={a.totals.totalLevyDue === null ? 'gray' : 'success'}
              />
              <StatCard
                label="Operators assessed"
                value={a.totals.operatorsAssessed}
                icon={Users}
                tone="info"
              />
            </div>

            <Card>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">
                    {a.period.label} assessment
                  </h3>
                  <p className="mt-1 text-sm text-gray-500">
                    {joinMeta(
                      a.template?.name,
                      `due ${formatDate(a.period.dueDate)}`,
                      a.rate ? `rate ${a.rate.ratePercent}%` : 'no rate set',
                    )}
                  </p>
                </div>
              </div>
              <div className="mt-4">
                <DataTable
                  columns={columns}
                  rows={a.rows}
                  rowKey={(r) => r.entity.id}
                  loading={assessmentQuery.isLoading}
                  error={assessmentQuery.isError}
                  onRetry={() => void assessmentQuery.refetch()}
                  emptyMessage="No approved returns for this period yet."
                />
              </div>
            </Card>
          </>
        )}

        {canSeeRates && (
          <Card>
            <h3 className="text-base font-semibold text-gray-900">Levy rates</h3>
            <p className="mt-1 text-sm text-gray-500">
              The rate applied to a period is the one whose dates cover that period&apos;s due date.
            </p>
            {ratesQuery.isLoading ? (
              <Skeleton className="mt-4 h-24 w-full" />
            ) : (ratesQuery.data ?? []).length === 0 ? (
              <EmptyState icon={Percent} message="No levy rate has been configured yet." />
            ) : (
              <ul className="mt-4 divide-y divide-gray-100">
                {(ratesQuery.data ?? []).map((rate) => (
                  <li key={rate.id} className="flex items-center gap-4 py-3">
                    <Badge tone="info">{ratePercentOf(rate)}%</Badge>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {rate.label ?? 'Levy rate'}
                      </p>
                      <p className="truncate text-xs text-gray-500">
                        {joinMeta(
                          `from ${formatDate(rate.effectiveFrom)}`,
                          rate.effectiveTo ? `to ${formatDate(rate.effectiveTo)}` : 'open-ended',
                        )}
                      </p>
                    </div>
                    {isAdmin && (
                      <IconButton
                        icon={Trash2}
                        label={`Remove the ${ratePercentOf(rate)}% rate`}
                        variant="danger"
                        onClick={() => setPendingDelete(rate)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      <Modal open={rateOpen} title="Add a levy rate" onClose={() => setRateOpen(false)} size="sm">
        <div className="space-y-4">
          <Field label="Rate (%)" htmlFor="levy-rate">
            <Input
              id="levy-rate"
              type="number"
              step="0.0001"
              min="0"
              max="100"
              value={form.ratePercent}
              onChange={(e) => setForm({ ...form, ratePercent: e.target.value })}
            />
          </Field>
          <Field label="In force from" htmlFor="levy-from">
            <Input
              id="levy-from"
              type="date"
              value={form.effectiveFrom}
              onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
            />
          </Field>
          <Field
            label="In force until"
            htmlFor="levy-to"
            hint="Leave blank if the rate has no end date."
          >
            <Input
              id="levy-to"
              type="date"
              value={form.effectiveTo}
              onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })}
            />
          </Field>
          <Field
            label="Label"
            htmlFor="levy-label"
            hint="Optional, e.g. the instrument it comes from."
          >
            <Input
              id="levy-label"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRateOpen(false)}>
              Cancel
            </Button>
            <Button
              isLoading={createRate.isPending}
              disabled={!form.ratePercent || !form.effectiveFrom}
              onClick={() => createRate.mutate()}
            >
              Add rate
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this levy rate?"
        confirmLabel="Delete"
        tone="danger"
        isLoading={removeRate.isPending}
        message={
          pendingDelete
            ? `Periods that fall in this rate's dates will no longer have a levy calculated.`
            : ''
        }
        onConfirm={() => pendingDelete && removeRate.mutate(pendingDelete.id)}
        onClose={() => setPendingDelete(null)}
      />
    </Page>
  );
}
