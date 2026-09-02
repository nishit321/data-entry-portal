import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Award, Info, Percent, Send, Trophy } from 'lucide-react';
import {
  Alert,
  Card,
  Combobox,
  EmptyState,
  FilterField,
  Page,
  PageHeader,
  Select,
  Skeleton,
  Tabs,
} from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import { benchmarkingApi, benchmarkingKeys, type BenchmarkFilters } from '../lib/benchmarking.api';
import { publishedTemplatePicker } from '../lib/pickers';
import { joinMeta } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import {
  ENTITY_TYPES,
  ENTITY_TYPE_LABELS,
  isOperatorRole,
  type ComplianceBenchmarkRow,
  type EntityType,
  type PeerSummary,
} from '../lib/types';

const TYPE_OPTIONS = [
  { value: '', label: 'All operator types' },
  ...ENTITY_TYPES.map((t) => ({ value: t, label: ENTITY_TYPE_LABELS[t] })),
];

function formatNumber(value: number | null, digits = 0): string {
  if (value === null) return '—';
  return value.toLocaleString('en-GB', { maximumFractionDigits: digits });
}

function formatRate(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/**
 * One metric, as the reader stands on it. The peer figures are absent whenever the group is too
 * small to quote them, and the card says so rather than showing a dash and leaving the reader to
 * wonder whether the data is missing or the comparison is being withheld.
 */
function StandingCard({
  label,
  summary,
  format,
  icon: Icon,
}: {
  label: string;
  summary: PeerSummary;
  format: (value: number | null) => string;
  icon: typeof Trophy;
}) {
  return (
    <Card>
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Icon size={15} aria-hidden />
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold text-gray-900">{format(summary.value)}</div>
      <div className="mt-3 space-y-1 text-sm text-gray-500">
        {summary.rank !== null && summary.groupSize > 1 && (
          <div>
            {ordinal(summary.rank)} of {summary.groupSize}
          </div>
        )}
        {summary.withheld ? (
          <div className="text-xs text-gray-500">
            Too few comparable operators to show a peer figure.
          </div>
        ) : (
          <div>Peer median {format(summary.median)}</div>
        )}
      </div>
    </Card>
  );
}

export function BenchmarkingPage() {
  const { user } = useAuth();
  const isOperator = !!user && isOperatorRole(user.role);
  const canFilter = !isOperator;

  const [entityType, setEntityType] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [fieldKey, setFieldKey] = useState('');
  const [tab, setTab] = useState<'compliance' | 'indicator'>('compliance');

  const filters: BenchmarkFilters = {
    entityType: canFilter && entityType ? (entityType as EntityType) : undefined,
    templateId: templateId || undefined,
  };

  const complianceQuery = useQuery({
    queryKey: benchmarkingKeys.compliance(filters),
    queryFn: () => benchmarkingApi.compliance(filters),
  });

  const catalogueQuery = useQuery({
    queryKey: benchmarkingKeys.indicators({ templateId: filters.templateId }),
    queryFn: () => benchmarkingApi.indicators({ templateId: filters.templateId }),
  });

  const indicators = useMemo(() => catalogueQuery.data?.indicators ?? [], [catalogueQuery.data]);
  // Open on the first available question rather than an empty picker, and fall back when the
  // questionnaire filter changes the catalogue underneath the current selection.
  useEffect(() => {
    if (indicators.length === 0) {
      if (fieldKey) setFieldKey('');
      return;
    }
    if (!indicators.some((i) => i.fieldKey === fieldKey)) {
      setFieldKey(indicators[0].fieldKey);
    }
  }, [indicators, fieldKey]);

  const indicatorQuery = useQuery({
    queryKey: benchmarkingKeys.indicator({ ...filters, fieldKey }),
    queryFn: () => benchmarkingApi.indicator({ ...filters, fieldKey }),
    enabled: fieldKey !== '',
  });

  const compliance = complianceQuery.data;
  const indicator = indicatorQuery.data;

  const complianceColumns: Column<ComplianceBenchmarkRow>[] = [
    { header: 'Operator', cell: (r) => r.entity.name, width: '28%' },
    {
      header: 'Type',
      cell: (r) => ENTITY_TYPE_LABELS[r.entity.type],
      width: '20%',
      hideOnMobile: true,
    },
    { header: 'Filed', cell: (r) => r.filed, align: 'right', width: '12%' },
    { header: 'Late', cell: (r) => r.late, align: 'right', width: '12%' },
    { header: 'On time', cell: (r) => formatRate(r.onTimeRate), align: 'right', width: '14%' },
    { header: 'Approved', cell: (r) => formatRate(r.approvalRate), align: 'right', width: '14%' },
  ];

  const indicatorColumns: Column<{
    entity: { id: string; name: string; type: EntityType };
    value: number | null;
  }>[] = [
    { header: 'Operator', cell: (r) => r.entity.name, width: '50%' },
    {
      header: indicator?.field?.unit ?? 'Reported',
      cell: (r) => (r.value === null ? 'Not reported' : formatNumber(r.value, 2)),
      align: 'right',
      width: '50%',
    },
  ];

  return (
    <Page>
      <div className="space-y-6">
        <PageHeader
          title="Benchmarking"
          description={
            isOperator
              ? "Where you stand against comparable operators. Peer figures are aggregates. No other operator's numbers are shown here, and yours are not shown to them."
              : 'How operators compare on filing behaviour and on the figures they report.'
          }
        />

        <div className="flex flex-wrap gap-4">
          {canFilter && (
            <FilterField label="Operator type" width="lg">
              <Select
                aria-label="Filter by operator type"
                options={TYPE_OPTIONS}
                value={entityType}
                onChange={setEntityType}
              />
            </FilterField>
          )}
          <FilterField label="Questionnaire" width="lg">
            <Combobox
              aria-label="Filter by questionnaire"
              emptyLabel="All questionnaires"
              placeholder="Search questionnaires…"
              source={publishedTemplatePicker}
              value={templateId}
              onChange={setTemplateId}
            />
          </FilterField>
        </div>

        <Tabs
          aria-label="Benchmark view"
          tabs={[
            { id: 'compliance', label: 'Filing behaviour' },
            { id: 'indicator', label: 'Reported figures' },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === 'compliance' &&
          (complianceQuery.isLoading || !compliance ? (
            <div className="grid gap-4 sm:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-32 w-full" />
              ))}
            </div>
          ) : compliance.peerGroup.size === 0 ? (
            <EmptyState message="There are no active operators to compare." />
          ) : (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-3">
                <StandingCard
                  label="Returns filed"
                  summary={compliance.metrics.filings}
                  format={(v) => formatNumber(v)}
                  icon={Send}
                />
                <StandingCard
                  label="Filed on time"
                  summary={compliance.metrics.onTimeRate}
                  format={formatRate}
                  icon={Percent}
                />
                <StandingCard
                  label="Approved first time"
                  summary={compliance.metrics.approvalRate}
                  format={formatRate}
                  icon={Award}
                />
              </div>

              {compliance.rows.length > 0 && (
                <DataTable
                  columns={complianceColumns}
                  rows={compliance.rows}
                  rowKey={(r) => r.entity.id}
                  emptyMessage="No operators match these filters."
                />
              )}
            </div>
          ))}

        {tab === 'indicator' && (
          <div className="space-y-6">
            <FilterField label="Question" width="xl">
              <Select
                aria-label="Choose a question to compare"
                options={indicators.map((i) => ({
                  value: i.fieldKey,
                  label: i.unit ? `${i.label} (${i.unit})` : i.label,
                }))}
                value={fieldKey}
                onChange={setFieldKey}
                placeholder={
                  catalogueQuery.isLoading ? 'Loading questions…' : 'No questions available'
                }
              />
            </FilterField>

            {indicatorQuery.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : !indicator || !indicator.field ? (
              <EmptyState message="Choose a question to compare." />
            ) : !indicator.period ? (
              <EmptyState message="No approved returns carry this figure yet." />
            ) : (
              <>
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-base font-semibold text-gray-900">
                      {indicator.field.label}
                    </h3>
                    <span className="text-sm text-gray-500">
                      {joinMeta(
                        indicator.period.label,
                        `${indicator.reporting} of ${indicator.peerGroup.size} reported`,
                      )}
                    </span>
                  </div>
                  <div className="mt-4 grid gap-4 sm:grid-cols-3">
                    <div>
                      <div className="text-xs text-gray-500">You reported</div>
                      <div className="mt-1 text-2xl font-semibold text-gray-900">
                        {formatNumber(indicator.summary.value, 2)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Rank</div>
                      <div className="mt-1 text-2xl font-semibold text-gray-900">
                        {indicator.summary.rank === null
                          ? '—'
                          : `${ordinal(indicator.summary.rank)} of ${indicator.summary.groupSize}`}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Share of the group</div>
                      <div className="mt-1 text-2xl font-semibold text-gray-900">
                        {formatRate(indicator.summary.shareOfTotal)}
                      </div>
                    </div>
                  </div>
                  {indicator.summary.withheld ? (
                    <div className="mt-4">
                      <Alert tone="info">
                        There are too few comparable operators to show peer figures without
                        identifying one of them.
                      </Alert>
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-gray-500">
                      {joinMeta(
                        `Peer median ${formatNumber(indicator.summary.median, 2)}`,
                        `peer average ${formatNumber(indicator.summary.mean, 2)}`,
                      )}
                    </p>
                  )}
                </Card>

                {indicator.rows.length > 0 && (
                  <DataTable
                    columns={indicatorColumns}
                    rows={indicator.rows}
                    rowKey={(r) => r.entity.id}
                    emptyMessage="No operators match these filters."
                  />
                )}

                {isOperator && (
                  <p className="flex items-start gap-2 text-xs text-gray-500">
                    <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
                    Peer figures are aggregates over comparable operators. Individual operators are
                    never named, and your figures are not shown to them.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </Page>
  );
}
