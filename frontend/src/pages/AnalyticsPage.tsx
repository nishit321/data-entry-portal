import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Download,
  Percent,
  ShieldAlert,
} from 'lucide-react';
import {
  Button,
  Card,
  Combobox,
  EmptyState,
  FilterField,
  Page,
  PageHeader,
  Skeleton,
  StatCard,
  useToast,
} from '../components/ui';
import { ComplianceTrendChart } from '../components/ComplianceTrendChart';
import { AnomalyPanel } from '../components/AnomalyPanel';
import { analyticsApi, analyticsKeys, type AnalyticsFilters } from '../lib/analytics.api';
import { exportsApi } from '../lib/exports.api';
import { entityPicker, publishedTemplatePicker } from '../lib/pickers';
import { getErrorMessage } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { isOperatorRole } from '../lib/types';

function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

export function AnalyticsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const isOperator = !!user && isOperatorRole(user.role);
  // Authority readers can narrow to one operator or template; operators only ever see their own.
  const canFilter = !isOperator;

  const [entityId, setEntityId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const filters: AnalyticsFilters = {
    entityId: canFilter ? entityId || undefined : undefined,
    templateId: templateId || undefined,
  };

  const summaryQuery = useQuery({
    queryKey: analyticsKeys.summary(filters),
    queryFn: () => analyticsApi.summary(filters),
  });
  const trendsQuery = useQuery({
    queryKey: analyticsKeys.trends({ ...filters, periods: 8 }),
    queryFn: () => analyticsApi.trends({ ...filters, periods: 8 }),
  });

  const s = summaryQuery.data;
  const onTimeRate =
    s && s.timeliness.onTime + s.timeliness.late > 0
      ? s.timeliness.onTime / (s.timeliness.onTime + s.timeliness.late)
      : null;

  const trendPoints = trendsQuery.data?.periods ?? [];

  const exportMutation = useMutation({
    mutationFn: () => exportsApi.complianceWorkbook(filters),
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't build the export.")),
  });

  return (
    <Page>
      <div className="space-y-6">
        <PageHeader
          title="Analytics"
          description={
            isOperator
              ? 'How your returns are tracking: what has been approved, what is in review, and your filing timeliness.'
              : 'Compliance across all operators: filing status, timeliness, the review pipeline, and open cases.'
          }
          actions={
            <Button
              variant="secondary"
              icon={Download}
              isLoading={exportMutation.isPending}
              onClick={() => exportMutation.mutate()}
            >
              Export to Excel
            </Button>
          }
        />

        {canFilter && (
          <div className="flex flex-wrap gap-4">
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
        )}

        {summaryQuery.isLoading || !s ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              label="Approved"
              value={s.submissions.approved}
              icon={CheckCircle2}
              tone="success"
            />
            <StatCard
              label="In review"
              value={s.submissions.underReview}
              icon={ClipboardCheck}
              tone="info"
            />
            <StatCard
              label="Sent back"
              value={s.submissions.rejected}
              icon={AlertTriangle}
              tone={s.submissions.rejected > 0 ? 'danger' : 'gray'}
            />
            <StatCard label="On-time rate" value={percent(onTimeRate)} icon={Clock} tone="brand" />
            <StatCard
              label="Filed late"
              value={s.timeliness.late}
              icon={Clock}
              tone={s.timeliness.late > 0 ? 'warning' : 'gray'}
            />
            <StatCard
              label="Open compliance cases"
              value={s.compliance.open}
              icon={ShieldAlert}
              tone={s.compliance.open > 0 ? 'warning' : 'gray'}
            />
          </div>
        )}

        <Card>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-gray-900">Filing timeliness</h3>
              <p className="mt-1 text-sm text-gray-500">
                Returns filed each reporting period, split into on time and late.
              </p>
            </div>
            {s && (
              <div className="flex items-center gap-1.5 text-sm text-gray-500">
                <Percent size={14} aria-hidden />
                {percent(s.approvalRate)} approved of decided
              </div>
            )}
          </div>
          <div className="mt-4">
            {trendsQuery.isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : trendPoints.length === 0 ? (
              <EmptyState message="No reporting periods to chart yet." />
            ) : (
              <ComplianceTrendChart points={trendPoints} />
            )}
          </div>
        </Card>

        <AnomalyPanel filters={filters} canSeeEntity={canFilter} />

        {s && (
          <Card>
            <h3 className="text-base font-semibold text-gray-900">Review pipeline</h3>
            <p className="mt-1 text-sm text-gray-500">
              Returns currently waiting at each review stage.
            </p>
            <div className="mt-4 grid grid-cols-3 gap-4 text-center">
              {(
                [
                  ['With Checker', s.pipeline.checker],
                  ['With Verifier', s.pipeline.verifier],
                  ['With Approver', s.pipeline.approver],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                  <div className="text-2xl font-semibold text-gray-900">{value}</div>
                  <div className="mt-1 text-xs text-gray-500">{label}</div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </Page>
  );
}
