import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Button, Card, FilterField, Page, PageHeader, Select, Skeleton } from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import {
  complaintKeys,
  complaintsByOperatorApi,
  type OperatorComplaints,
} from '../lib/complaints.api';
import { COMPLAINT_CATEGORY_LABELS } from '../lib/types';

const WINDOWS = [
  { value: '3', label: 'Last 3 months' },
  { value: '6', label: 'Last 6 months' },
  { value: '12', label: 'Last 12 months' },
  { value: '24', label: 'Last 24 months' },
];

function percent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

/**
 * A row of bars, one per month, scaled to the busiest month on the page.
 *
 * Small on purpose: this is a direction at a glance beside each operator, not a chart to read
 * figures off. The figures are in the label, for anybody who cannot see the bars.
 */
function MonthBars({ months, max }: { months: { month: string; count: number }[]; max: number }) {
  const label = months.map((m) => `${m.month}: ${m.count}`).join(', ');
  return (
    <div className="flex h-6 items-end gap-0.5" role="img" aria-label={`By month. ${label}`}>
      {months.map((m) => (
        <div
          key={m.month}
          className="w-1.5 rounded-sm bg-brand-500"
          style={{ height: `${Math.max(m.count > 0 ? 12 : 4, (m.count / max) * 100)}%` }}
          title={`${m.month}: ${m.count}`}
        />
      ))}
    </div>
  );
}

/**
 * Complaints grouped by the operator they are about (NCA, October 2026).
 *
 * The Authority's own view, so every operator is named and every figure shown, however small. The
 * public page has its own version, off unless an administrator publishes it, with a threshold.
 *
 * "Reached an end" is resolved or closed, the same as on the public page, so one word does not
 * mean two things across the portal. Choosing an operator opens the case list filtered to it.
 */
export function ComplaintsByOperatorPage() {
  const navigate = useNavigate();
  const [months, setMonths] = useState('12');

  const query = useQuery({
    queryKey: complaintKeys.byOperator(Number(months)),
    queryFn: () => complaintsByOperatorApi.get(Number(months)),
  });
  const data = query.data;
  const rows = data
    ? [...data.operators, ...(data.unattributed.received > 0 ? [data.unattributed] : [])]
    : [];
  const busiestMonth = Math.max(1, ...rows.flatMap((r) => r.byMonth.map((m) => m.count)));

  const columns: Column<OperatorComplaints>[] = [
    {
      header: 'Operator',
      cell: (r) =>
        r.entity ? (
          <span className="font-medium text-gray-900">{r.entity.name}</span>
        ) : (
          // Said, not left blank: these are real complaints whose filer did not know whose fault.
          <span className="italic text-gray-600">Operator not named</span>
        ),
    },
    { header: 'Received', width: '7rem', align: 'right', cell: (r) => r.received },
    { header: 'Still open', width: '7rem', align: 'right', cell: (r) => r.open },
    {
      header: 'Reached an end',
      width: '9rem',
      align: 'right',
      cell: (r) => `${r.resolved} (${percent(r.resolutionRate)})`,
    },
    {
      header: 'Typical days',
      width: '8rem',
      align: 'right',
      cell: (r) => (r.medianDaysToResolve === null ? '—' : r.medianDaysToResolve),
    },
    {
      header: 'Most common',
      width: '11rem',
      hideOnMobile: true,
      cell: (r) => (r.byCategory[0] ? COMPLAINT_CATEGORY_LABELS[r.byCategory[0].category] : '—'),
    },
    {
      header: 'By month',
      width: '9rem',
      hideOnMobile: true,
      cell: (r) => <MonthBars months={r.byMonth} max={busiestMonth} />,
    },
  ];

  return (
    <Page>
      <div className="space-y-6">
        <PageHeader
          title="Complaints by operator"
          description="How many complaints each operator received, how many have reached an end, and how long that typically took."
          actions={
            <Link to="/complaints">
              <Button variant="secondary" icon={ArrowLeft}>
                All complaints
              </Button>
            </Link>
          }
        />

        <div className="flex flex-wrap gap-4">
          <FilterField label="Period" width="md">
            <Select
              aria-label="How far back to count"
              options={WINDOWS}
              value={months}
              onChange={setMonths}
            />
          </FilterField>
        </div>

        <Card>
          <p className="text-sm text-gray-600">
            A larger operator serves more people and will receive more complaints. How many reach an
            end, and how quickly, is the fairer comparison. Choose an operator to see its cases.
          </p>
          <div className="mt-4">
            {query.isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <DataTable
                label="Complaints by operator"
                columns={columns}
                rows={rows}
                rowKey={(r) => r.entity?.id ?? 'unattributed'}
                error={query.isError}
                onRetry={() => void query.refetch()}
                emptyMessage="No complaints in this period."
                onRowClick={(r) => {
                  if (r.entity) navigate(`/complaints?aboutEntityId=${r.entity.id}`);
                }}
              />
            )}
          </div>
        </Card>
      </div>
    </Page>
  );
}
