import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarX,
  CircleSlash,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { Badge, Card, Checkbox, EmptyState, Select, Skeleton } from './ui';
import {
  analyticsApi,
  analyticsKeys,
  type AnalyticsFilters,
  type AnomalyFilters,
} from '../lib/analytics.api';
import { joinMeta } from '../lib/format';
import { ANOMALY_KIND_LABELS, type AnomalyKind, type AnomalyRow } from '../lib/types';

/** The icon carries the direction, so a reader can scan the column without reading every row. */
const KIND_ICONS: Record<AnomalyKind, typeof ArrowUpRight> = {
  SPIKE: ArrowUpRight,
  DROP: ArrowDownRight,
  NEW_ZERO: CircleSlash,
  FIRST_REPORT: Sparkles,
  DRIFT: TrendingUp,
  SEASONAL_BREAK: CalendarX,
};

const SEVERITY_OPTIONS = [
  { value: '', label: 'All flags' },
  { value: 'HIGH', label: 'Severe only' },
];

function formatNumber(value: number): string {
  return value.toLocaleString('en-GB', { maximumFractionDigits: 2 });
}

function AnomalyItem({ row, canSeeEntity }: { row: AnomalyRow; canSeeEntity: boolean }) {
  const Icon = KIND_ICONS[row.anomaly.kind];
  const severe = row.anomaly.severity === 'HIGH';

  return (
    <li className="flex items-start gap-3 border-b border-gray-100 py-3 last:border-0">
      <span
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          severe ? 'bg-danger-100 text-danger-700' : 'bg-warning-100 text-warning-700'
        }`}
      >
        <Icon size={15} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            to={`/submissions/${row.submissionId}`}
            className="text-sm font-medium text-gray-900 hover:text-brand-700 hover:underline"
          >
            {row.field.label}
          </Link>
          <Badge tone={severe ? 'danger' : 'warning'}>
            {ANOMALY_KIND_LABELS[row.anomaly.kind]}
          </Badge>
          {row.field.unit && <span className="text-xs text-gray-500">{row.field.unit}</span>}
        </div>
        <p className="mt-1 text-sm text-gray-600">{row.anomaly.explanation}</p>
        {row.statistical && row.statistical.explanation !== row.anomaly.explanation && (
          <p className="mt-1 text-sm text-gray-500">{row.statistical.explanation}</p>
        )}
        <p className="mt-1 text-xs text-gray-500">
          {joinMeta(canSeeEntity && row.entity.name, row.period.label, row.template.name)}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-sm font-semibold tabular-nums text-gray-900">
          {formatNumber(row.anomaly.value)}
        </div>
        {row.anomaly.baseline !== null && (
          <div className="mt-0.5 text-xs tabular-nums text-gray-500">
            was {formatNumber(row.anomaly.baseline)}
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * Figures that moved implausibly against the operator's own history (Phase 2).
 *
 * This is the counterpart to the period-on-period rule an analyst configures on a question: that
 * one warns the operator as they file, this one sweeps everything afterwards, including the
 * questions nobody thought to put a rule on.
 */
export function AnomalyPanel({
  filters,
  canSeeEntity,
}: {
  filters: AnalyticsFilters;
  canSeeEntity: boolean;
}) {
  const [severity, setSeverity] = useState('');
  const [includeFirstReports, setIncludeFirstReports] = useState(false);
  const query: AnomalyFilters = {
    ...filters,
    severity: severity === 'HIGH' ? 'HIGH' : undefined,
    includeFirstReports: includeFirstReports || undefined,
    limit: 25,
  };

  const { data, isLoading } = useQuery({
    queryKey: analyticsKeys.anomalies(query),
    queryFn: () => analyticsApi.anomalies(query),
  });

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Figures worth a second look</h3>
          <p className="mt-1 text-sm text-gray-500">
            {canSeeEntity
              ? "Numbers that moved sharply against the operator's own recent filings. A flag is a prompt to check, not a finding."
              : 'Numbers that moved sharply against your own recent filings. Worth checking before a reviewer asks.'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Select
            aria-label="Filter flags by severity"
            options={SEVERITY_OPTIONS}
            value={severity}
            onChange={setSeverity}
            className="w-40"
          />
          <Checkbox
            checked={includeFirstReports}
            onChange={setIncludeFirstReports}
            label="Show first-time figures"
          />
        </div>
      </div>

      {data && data.total > 0 && (
        <p className="mt-3 text-xs text-gray-500">
          {joinMeta(
            `${data.total} ${data.total === 1 ? 'flag' : 'flags'}`,
            data.high > 0 && `${data.high} severe`,
            `movement over ${data.thresholdPercent}% against a median of recent approved periods`,
          )}
        </p>
      )}

      <div className="mt-2">
        {isLoading ? (
          <div className="space-y-3 pt-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : !data || data.rows.length === 0 ? (
          <EmptyState
            message={
              severity
                ? 'No severe movements in the filings covered by these filters.'
                : 'Nothing stands out. Reported figures are in line with recent periods.'
            }
          />
        ) : (
          <ul>
            {data.rows.map((row) => (
              <AnomalyItem
                key={`${row.submissionId}:${row.field.key}`}
                row={row}
                canSeeEntity={canSeeEntity}
              />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
