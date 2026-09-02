import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  FileEdit,
} from 'lucide-react';
import { Alert, Badge, Button, Card, EmptyState, Page, StatCard } from '../components/ui';
import { submissionsApi } from '../lib/submissions.api';
import { workflowApi } from '../lib/workflow.api';
import { periodsApi } from '../lib/reporting-periods.api';
import { useAuth } from '../context/AuthContext';
import { formatDate, joinMeta } from '../lib/format';
import { isOperatorRole, REVIEW_STAGES, ROLE_LABELS, type Role } from '../lib/types';

/** Within this many days of the due date, a period is called out rather than merely listed. */
const DUE_SOON_DAYS = 14;

function daysUntil(date: string): number {
  return Math.ceil((new Date(date).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

function isReviewer(role: Role): boolean {
  return (REVIEW_STAGES as readonly string[]).includes(role);
}

/**
 * The dashboard (FRONTEND_STANDARDS §3.7, §3.11).
 *
 * The previous version showed three tiles reading back the signed-in user's own role, status, and
 * email — information they already had, on the screen they see first. This answers the question
 * each role actually opens the portal with:
 *
 *  - an operator: what have I not finished, what has come back to me, and what is due soon
 *  - a reviewer: how much is waiting on me, and how long has the oldest been sitting there
 *  - an administrator: which periods are open and how the current filing round is going
 *
 * Every tile links into the list that backs it with the filters already applied — which is only
 * possible now that list state lives in the URL (§2).
 */
export function DashboardPage() {
  const { user } = useAuth();
  if (!user) return null;

  const operator = isOperatorRole(user.role);
  const reviewer = isReviewer(user.role);

  return (
    <Page>
      <div className="space-y-6">
        <div className="rounded-xl bg-gradient-to-r from-brand-800 to-brand-600 p-6 text-white shadow-sm">
          <h2 className="text-xl font-semibold">Welcome back, {user.firstName}</h2>
          <p className="mt-1 text-sm text-brand-100">
            You are signed in as {ROLE_LABELS[user.role]}.
          </p>
        </div>

        {operator && <OperatorPanel />}
        {reviewer && <ReviewerPanel />}
        {!operator && <PeriodsPanel />}
      </div>
    </Page>
  );
}

/** What the operator still owes, and what has come back to them. */
function OperatorPanel() {
  const drafts = useQuery({
    queryKey: ['submissions', 'dashboard', 'DRAFT'],
    queryFn: () => submissionsApi.list({ page: 1, pageSize: 5, status: 'DRAFT' }),
  });
  const returned = useQuery({
    queryKey: ['submissions', 'dashboard', 'REJECTED'],
    queryFn: () => submissionsApi.list({ page: 1, pageSize: 5, status: 'REJECTED' }),
  });
  const startable = useQuery({
    queryKey: ['submissions', 'startable-periods'],
    queryFn: () => submissionsApi.startablePeriods(),
  });

  const draftCount = drafts.data?.meta.total ?? 0;
  const returnedCount = returned.data?.meta.total ?? 0;
  const notStarted = startable.data ?? [];
  const dueSoon = notStarted.filter((p) => daysUntil(p.dueDate) <= DUE_SOON_DAYS);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link to="/submissions?status=DRAFT" className="focus:outline-none">
          <StatCard label="Drafts in progress" value={draftCount} icon={FileEdit} tone="info" />
        </Link>
        <Link to="/submissions?status=REJECTED" className="focus:outline-none">
          <StatCard
            label="Sent back to you"
            value={returnedCount}
            icon={AlertTriangle}
            tone={returnedCount > 0 ? 'danger' : 'gray'}
          />
        </Link>
        <StatCard
          label="Not started yet"
          value={notStarted.length}
          icon={ClipboardList}
          tone={dueSoon.length > 0 ? 'warning' : 'gray'}
        />
      </div>

      {returnedCount > 0 && (
        <Alert tone="danger">
          <p className="font-medium">
            {returnedCount === 1
              ? 'One return has been sent back for changes.'
              : `${returnedCount} returns have been sent back for changes.`}
          </p>
          <p className="mt-1 text-sm">
            Open each one to read the Authority&apos;s notes, then revise and resubmit.
          </p>
          <div className="mt-3">
            <Link to="/submissions?status=REJECTED">
              <Button size="sm" variant="secondary">
                See what came back
              </Button>
            </Link>
          </div>
        </Alert>
      )}

      <Card>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Coming up</h3>
            <p className="mt-1 text-sm text-gray-500">
              Reporting periods you can still start, soonest deadline first.
            </p>
          </div>
          <Link to="/submissions">
            <Button variant="secondary" size="sm">
              All returns <ArrowRight size={14} className="ml-1.5" aria-hidden />
            </Button>
          </Link>
        </div>

        {notStarted.length === 0 ? (
          <div className="mt-2">
            <EmptyState
              icon={ClipboardCheck}
              message="You've started a return for every open period. Nothing else is waiting on you."
            />
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-gray-100">
            {[...notStarted]
              .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
              .slice(0, 5)
              .map((period) => {
                const days = daysUntil(period.dueDate);
                return (
                  <li key={period.id} className="flex items-center justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900">{period.label}</p>
                      <p className="truncate text-xs text-gray-500">
                        {joinMeta(period.template.name, `due ${formatDate(period.dueDate)}`)}
                      </p>
                    </div>
                    {days <= DUE_SOON_DAYS && (
                      <Badge tone={days < 0 ? 'danger' : 'warning'}>
                        {days < 0
                          ? `${Math.abs(days)} days overdue`
                          : days === 0
                            ? 'Due today'
                            : `${days} days left`}
                      </Badge>
                    )}
                  </li>
                );
              })}
          </ul>
        )}
      </Card>
    </>
  );
}

/** How much is waiting on this reviewer, and how long the oldest has been there. */
function ReviewerPanel() {
  const queue = useQuery({
    queryKey: ['workflow', 'dashboard-queue'],
    queryFn: () => workflowApi.queue({ page: 1, pageSize: 5, sort: 'submittedAt', order: 'asc' }),
  });

  const total = queue.data?.meta.total ?? 0;
  const rows = queue.data?.data ?? [];
  const oldest = rows[0]?.submittedAt;
  const waitingDays = oldest ? -daysUntil(oldest) : 0;

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Waiting for your review</h3>
          <p className="mt-1 text-sm text-gray-500">
            {total === 0
              ? 'Nothing is waiting at your stage right now.'
              : `${total} ${total === 1 ? 'return' : 'returns'} at your stage${
                  waitingDays > 0 ? `, the oldest for ${waitingDays} days` : ''
                }.`}
          </p>
        </div>
        <Link to="/review-queue">
          <Button variant="secondary" size="sm">
            Open the queue <ArrowRight size={14} className="ml-1.5" aria-hidden />
          </Button>
        </Link>
      </div>

      {rows.length > 0 && (
        <ul className="mt-4 divide-y divide-gray-100">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <Link
                  to={`/submissions/${row.id}`}
                  className="truncate text-sm font-medium text-gray-900 hover:underline"
                >
                  {row.referenceNumber ?? row.period.label}
                </Link>
                <p className="truncate text-xs text-gray-500">
                  {joinMeta(row.entity.name, row.template.name)}
                </p>
              </div>
              {row.isLate && <Badge tone="warning">Late</Badge>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Which periods are open, and how the current filing round is going. */
function PeriodsPanel() {
  const open = useQuery({
    queryKey: ['reporting-periods', 'dashboard-open'],
    queryFn: () =>
      periodsApi.list({ page: 1, pageSize: 5, status: 'OPEN', sort: 'dueDate', order: 'asc' }),
  });
  const late = useQuery({
    queryKey: ['submissions', 'dashboard-late'],
    queryFn: () => submissionsApi.list({ page: 1, pageSize: 1, isLate: true }),
  });
  const inReview = useQuery({
    queryKey: ['submissions', 'dashboard-in-review'],
    queryFn: () => submissionsApi.list({ page: 1, pageSize: 1, status: 'UNDER_REVIEW' }),
  });

  const openPeriods = open.data?.data ?? [];
  const lateCount = late.data?.meta.total ?? 0;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link to="/reporting-periods?status=OPEN" className="focus:outline-none">
          <StatCard
            label="Open periods"
            value={open.data?.meta.total ?? 0}
            icon={CalendarClock}
            tone="brand"
          />
        </Link>
        <Link to="/submissions?status=UNDER_REVIEW" className="focus:outline-none">
          <StatCard
            label="In review"
            value={inReview.data?.meta.total ?? 0}
            icon={ClipboardCheck}
            tone="info"
          />
        </Link>
        <Link to="/submissions?isLate=true" className="focus:outline-none">
          <StatCard
            label="Filed late"
            value={lateCount}
            icon={AlertTriangle}
            tone={lateCount > 0 ? 'warning' : 'gray'}
          />
        </Link>
      </div>

      <Card>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Open reporting periods</h3>
            <p className="mt-1 text-sm text-gray-500">
              What operators are filing against right now, soonest deadline first.
            </p>
          </div>
          <Link to="/reporting-periods">
            <Button variant="secondary" size="sm">
              All periods <ArrowRight size={14} className="ml-1.5" aria-hidden />
            </Button>
          </Link>
        </div>

        {openPeriods.length === 0 ? (
          <div className="mt-2">
            <EmptyState
              icon={CalendarClock}
              message="No period is open. Operators can't file anything until one is."
            />
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-gray-100">
            {openPeriods.map((period) => {
              const days = daysUntil(period.dueDate);
              return (
                <li key={period.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <Link
                      to={`/submissions?periodId=${period.id}`}
                      className="truncate text-sm font-medium text-gray-900 hover:underline"
                    >
                      {period.label}
                    </Link>
                    <p className="truncate text-xs text-gray-500">
                      {joinMeta(period.template.name, `due ${formatDate(period.dueDate)}`)}
                    </p>
                  </div>
                  {days <= DUE_SOON_DAYS && (
                    <Badge tone={days < 0 ? 'danger' : 'warning'}>
                      {days < 0 ? 'Past due' : days === 0 ? 'Due today' : `${days} days left`}
                    </Badge>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
