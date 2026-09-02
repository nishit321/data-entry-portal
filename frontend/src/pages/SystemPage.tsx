import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Database, Play, RefreshCw } from 'lucide-react';
import { Alert, Badge, Button, Card, Page, PageHeader, Skeleton, useToast } from '../components/ui';
import { systemApi, systemKeys, type JobStatus } from '../lib/system.api';
import { getErrorMessage } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { formatDateTime } from '../lib/format';

/** How often the page re-checks by itself, so a screen left open stays honest. */
const REFRESH_MS = 30_000;

const JOB_LABELS: Record<JobStatus['name'], string> = {
  'compliance-sweep': 'Compliance check',
  'document-expiry': 'Document expiry check',
  'notification-retry': 'Email retry',
};

const JOB_DESCRIPTIONS: Record<JobStatus['name'], string> = {
  'compliance-sweep':
    'Opens a case against any operator that did not file once the grace period has ended.',
  'document-expiry': 'Alerts operators whose licence or certificate is close to expiring.',
  'notification-retry': 'Sends again any email that failed to go out.',
};

/**
 * System health for the Authority's administrators.
 *
 * The background jobs run unattended overnight, so after a deployment or an outage somebody has to
 * be able to answer "did last night's checks actually run?" without opening server logs. That is
 * what this screen is for.
 */
export function SystemPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const canRunJobs = user?.role === 'ADMIN';

  const schedulerQuery = useQuery({
    queryKey: systemKeys.scheduler,
    queryFn: () => systemApi.scheduler(),
    refetchInterval: REFRESH_MS,
  });

  const healthQuery = useQuery({
    queryKey: systemKeys.health,
    queryFn: () => systemApi.health(),
    refetchInterval: REFRESH_MS,
  });

  const runMutation = useMutation({
    mutationFn: (name: JobStatus['name']) => systemApi.runJob(name),
    onSuccess: (run, name) => {
      void qc.invalidateQueries({ queryKey: systemKeys.scheduler });
      if (run?.ok) toast.success(JOB_LABELS[name] + ': ' + run.summary);
      else toast.error(JOB_LABELS[name] + ' did not finish. ' + (run?.summary ?? ''));
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't run that check.")),
  });

  const scheduler = schedulerQuery.data;
  const health = healthQuery.data;

  return (
    <Page>
      <div className="space-y-6">
        <PageHeader
          title="System health"
          description="Whether the service is up, and whether the overnight checks are running."
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <div className="flex items-center gap-3">
              <Activity className="size-5 text-gray-500" aria-hidden />
              <div className="min-w-0">
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Service
                </div>
                {healthQuery.isLoading ? (
                  <Skeleton className="mt-1 h-5 w-24" />
                ) : healthQuery.isError ? (
                  <Badge tone="danger">Not reachable</Badge>
                ) : (
                  <Badge tone={health?.status === 'ok' ? 'success' : 'warning'}>
                    {health?.status === 'ok' ? 'Running' : 'Degraded'}
                  </Badge>
                )}
              </div>
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-3">
              <Database className="size-5 text-gray-500" aria-hidden />
              <div className="min-w-0">
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Database
                </div>
                {healthQuery.isLoading ? (
                  <Skeleton className="mt-1 h-5 w-24" />
                ) : (
                  <Badge tone={health?.database === 'up' ? 'success' : 'danger'}>
                    {health?.database === 'up' ? 'Connected' : 'Not connected'}
                  </Badge>
                )}
              </div>
            </div>
          </Card>
        </div>

        <Card>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-gray-900">Overnight checks</h3>
              <p className="mt-1 text-sm text-gray-500">
                These run on a timer. You can also run one now, which is safe to repeat.
              </p>
            </div>
            <Button
              variant="secondary"
              icon={RefreshCw}
              onClick={() => void schedulerQuery.refetch()}
            >
              Refresh
            </Button>
          </div>

          {scheduler && !scheduler.enabled && (
            <div className="mt-4">
              <Alert tone="warning">
                <p className="font-medium">Scheduled runs are switched off on this server.</p>
                <p className="mt-1 text-sm">
                  The checks below will only happen when someone runs them by hand. If that is not
                  intended, tell the portal team.
                </p>
              </Alert>
            </div>
          )}

          {schedulerQuery.isLoading ? (
            <div className="mt-4 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-gray-100">
              {(scheduler?.jobs ?? []).map((job) => (
                <li key={job.name} className="flex flex-wrap items-start gap-3 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">
                        {JOB_LABELS[job.name]}
                      </span>
                      {job.running && <Badge tone="info">Running now</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">{JOB_DESCRIPTIONS[job.name]}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {job.lastRun
                        ? 'Last run ' +
                          formatDateTime(job.lastRun.finishedAt) +
                          ': ' +
                          job.lastRun.summary
                        : 'Has not run yet on this server.'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {job.lastRun && (
                      <Badge tone={job.lastRun.ok ? 'success' : 'danger'}>
                        {job.lastRun.ok ? 'Last run fine' : 'Last run failed'}
                      </Badge>
                    )}
                    {canRunJobs && (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={Play}
                        isLoading={runMutation.isPending && runMutation.variables === job.name}
                        onClick={() => runMutation.mutate(job.name)}
                      >
                        Run now
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Page>
  );
}
