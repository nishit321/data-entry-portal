import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { strings } from '../lib/strings';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Building2,
  CalendarCheck,
  FileSpreadsheet,
  FileText,
  Info,
  MessageSquare,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  SearchInput,
  Select,
  Skeleton,
  useToast,
  type SelectOption,
} from '../components/ui';
import { PublicIndicatorChart } from '../components/PublicIndicatorChart';
import { publicPortalApi, publicPortalKeys } from '../lib/public-portal.api';
import { getErrorMessage } from '../lib/api';
import {
  COMPLAINT_CATEGORY_LABELS,
  ENTITY_TYPE_LABELS,
  PUBLIC_AGGREGATION_LABELS,
  type PublicPortalFilters,
} from '../lib/types';

function StatTile({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: typeof Building2;
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Icon size={15} aria-hidden />
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold text-gray-900">{value}</div>
    </div>
  );
}

/**
 * The public open-data page (Q4).
 *
 * Everything here is sector-level and comes from returns the Authority has approved and periods it
 * has closed. No account is needed and none of it names an operator — that is decided on the
 * server, not here, but the page says so plainly because a reader is entitled to know what they
 * are and are not looking at.
 */
export function OpenDataPage() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [downloading, setDownloading] = useState<'xlsx' | 'pdf' | null>(null);

  const filters: PublicPortalFilters = useMemo(
    () => ({ search: search || undefined, from: from || undefined, to: to || undefined }),
    [search, from, to],
  );
  const filtered = Boolean(search || from || to);

  const overviewQuery = useQuery({
    queryKey: publicPortalKeys.overview,
    queryFn: () => publicPortalApi.overview(),
  });
  const indicatorsQuery = useQuery({
    queryKey: publicPortalKeys.indicators(8, filters),
    queryFn: () => publicPortalApi.indicators(8, filters),
    // Keep the figures on screen while a narrower set is fetched, so the page does not blink back
    // to skeletons on every keystroke.
    placeholderData: (previous) => previous,
  });
  const periodsQuery = useQuery({
    queryKey: publicPortalKeys.periods,
    queryFn: () => publicPortalApi.periods(),
  });
  const complaintsQuery = useQuery({
    queryKey: publicPortalKeys.complaints,
    queryFn: () => publicPortalApi.complaintsSummary(),
  });

  const overview = overviewQuery.data;
  const report = indicatorsQuery.data;
  const complaints = complaintsQuery.data;

  /*
   * The range is chosen by period, not by calendar date.
   *
   * A reader thinks in "the 2025 quarters", not in due dates, and only closed periods are ever
   * published — so a free date picker would offer ranges with nothing in them. The value behind
   * each option is still a date, because that is what the server filters on.
   */
  const periodOptions = periodsQuery.data ?? [];
  const fromOptions: SelectOption[] = [
    { value: '', label: 'The earliest published' },
    ...periodOptions.map((p) => ({ value: p.dueDate, label: p.label })),
  ];
  const toOptions: SelectOption[] = [
    { value: '', label: 'The latest published' },
    ...periodOptions.map((p) => ({ value: p.dueDate, label: p.label })),
  ];

  async function download(format: 'xlsx' | 'pdf') {
    setDownloading(format);
    try {
      await publicPortalApi.download(format, filters);
    } catch (err) {
      toast.error(getErrorMessage(err, "We couldn't prepare that download. Please try again."));
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-100 bg-white">
        <div className="mx-auto max-w-5xl px-6 py-8">
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft size={14} aria-hidden />
            {strings.action.backToSignIn}
          </Link>
          <h1 className="mt-4 text-3xl font-semibold text-gray-900">
            South Sudan communications sector
          </h1>
          <p className="mt-2 max-w-2xl text-gray-600">
            Figures reported by licensed operators to the National Communication Authority, combined
            across the sector. Published once the Authority has approved the returns and closed the
            reporting period.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-6 py-8">
        {overviewQuery.isLoading || !overview ? (
          <div className="grid gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatTile
                label="Licensed operators"
                value={overview.licensedOperators}
                icon={Building2}
              />
              <StatTile
                label="Periods published"
                value={overview.periodsPublished}
                icon={CalendarCheck}
              />
              <StatTile
                label="Citizen reports received"
                value={complaints?.total ?? '—'}
                icon={MessageSquare}
              />
            </div>
            {overview.byType.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {overview.byType.map((row) => (
                  <Badge key={row.type} tone="gray">
                    {ENTITY_TYPE_LABELS[row.type]}: {row.count}
                  </Badge>
                ))}
              </div>
            )}
          </>
        )}

        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold text-gray-900">Sector figures</h2>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon={FileSpreadsheet}
                isLoading={downloading === 'xlsx'}
                disabled={!report || report.indicators.length === 0}
                onClick={() => void download('xlsx')}
              >
                Excel
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={FileText}
                isLoading={downloading === 'pdf'}
                disabled={!report || report.indicators.length === 0}
                onClick={() => void download('pdf')}
              >
                PDF
              </Button>
            </div>
          </div>

          <Card>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_12rem_12rem]">
              <Field label="Find a figure" htmlFor="open-search">
                <SearchInput
                  id="open-search"
                  value={search}
                  onChange={setSearch}
                  placeholder="For example subscribers, or fibre"
                  aria-label="Find a figure"
                />
              </Field>
              <Field label="From" htmlFor="open-from">
                <Select id="open-from" value={from} options={fromOptions} onChange={setFrom} />
              </Field>
              <Field label="To" htmlFor="open-to">
                <Select id="open-to" value={to} options={toOptions} onChange={setTo} />
              </Field>
            </div>
            {filtered && (
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-xs text-gray-500">
                  {/* Said plainly, because a download of a narrowed view is easy to mistake for
                      the whole sector once it is sitting in a folder. */}
                  Downloads cover what is shown here.
                </p>
                <button
                  type="button"
                  className="text-xs font-medium text-brand-700 hover:text-brand-800"
                  onClick={() => {
                    setSearch('');
                    setFrom('');
                    setTo('');
                  }}
                >
                  {strings.action.clearFilters}
                </button>
              </div>
            )}
          </Card>

          {indicatorsQuery.isLoading ? (
            <Skeleton className="h-56 w-full" />
          ) : !report || report.indicators.length === 0 ? (
            <Card>
              <EmptyState
                message={
                  filtered
                    ? 'Nothing published matches what you are looking for. Try a different word, or widen the period.'
                    : 'No sector figures have been published yet. They appear here once the Authority publishes them.'
                }
              />
            </Card>
          ) : (
            report.indicators.map((indicator) => (
              <Card key={indicator.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-base font-semibold text-gray-900">{indicator.label}</h3>
                  <span className="text-xs text-gray-500">
                    {PUBLIC_AGGREGATION_LABELS[indicator.aggregation]}
                  </span>
                </div>
                {indicator.description && (
                  <p className="mt-1 text-sm text-gray-600">{indicator.description}</p>
                )}
                <div className="mt-4">
                  <PublicIndicatorChart points={indicator.points} unit={indicator.unit} />
                </div>
                {indicator.points.some((p) => p.withheld) && (
                  <p className="mt-3 flex items-start gap-2 text-xs text-gray-500">
                    <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
                    Periods shown as a dash are not published: fewer than {report.threshold}{' '}
                    operators reported, and a figure resting on so few would point at a named
                    company.
                  </p>
                )}
              </Card>
            ))
          )}
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-gray-900">Citizen reports</h2>
          {complaintsQuery.isLoading || !complaints ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <Card>
              <div className="grid gap-4 sm:grid-cols-4">
                {(
                  [
                    ['Received', complaints.byStatus.received],
                    ['In review', complaints.byStatus.inReview],
                    ['Resolved', complaints.byStatus.resolved],
                    ['Closed', complaints.byStatus.closed],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                    <div className="text-2xl font-semibold text-gray-900">{value}</div>
                    <div className="mt-1 text-xs text-gray-500">{label}</div>
                  </div>
                ))}
              </div>

              {complaints.resolution.medianDays !== null && (
                <p className="mt-4 text-sm text-gray-600">
                  Half of resolved reports were closed within {complaints.resolution.medianDays}{' '}
                  days.
                </p>
              )}

              {complaints.byCategory.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {complaints.byCategory.map((row) => (
                    <Badge key={row.category} tone="info">
                      {COMPLAINT_CATEGORY_LABELS[row.category]}: {row.count}
                    </Badge>
                  ))}
                </div>
              )}

              <p className="mt-4 text-sm text-gray-500">
                Have something to report?{' '}
                <Link to="/complaints/file" className="text-brand-700 underline">
                  File it here
                </Link>
                .
              </p>
            </Card>
          )}
        </section>

        <p className="pb-4 text-xs text-gray-500">
          Figures on this page are combined across operators. Individual operators&apos; reported
          figures are commercially confidential and are not published.
        </p>
      </main>
    </div>
  );
}
