import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { EnforcementService } from '../enforcement/enforcement.service';
import { DocumentsService } from '../documents/documents.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SchedulerConfig } from '../config/configuration';
import { ReportsService } from '../reports/reports.service';
import { ApiClientsService } from '../machine-api/api-clients.service';
import { FeedsService } from '../feeds/feeds.service';
import { RequestContext } from '../common/utils/request-context.util';

/** The jobs this process runs, in the order they are registered. */
export type JobName =
  | 'compliance-sweep'
  | 'document-expiry'
  | 'notification-retry'
  | 'penalty-accrual'
  | 'scheduled-reports'
  | 'nonce-sweep'
  | 'network-feeds';

/** Background work has no HTTP request behind it, so audit entries carry this instead. */
const SYSTEM_CONTEXT: RequestContext = { userAgent: 'scheduler' };

/** What a run produced, kept in memory so an operator can see the jobs are alive. */
export interface JobRun {
  name: JobName;
  startedAt: Date;
  finishedAt: Date;
  ok: boolean;
  summary: string;
}

/**
 * The background scheduler.
 *
 * Seven pieces of work were written to be driven on a timer rather than on demand: the compliance
 * sweep (a period whose grace lapsed while it was still open), the document expiry sweep, the
 * notification email retry, the penalty accrual that keeps open cases priced and closes the ones
 * whose missing return has since arrived, and the scheduled sector reports. This registers them as
 * cron jobs.
 *
 * Three things make it safe to leave running:
 *
 *  - **It does not run in tests.** A sweep firing mid-suite would make assertions depend on the
 *    clock, which is exactly the flakiness this codebase has already been bitten by.
 *  - **A job never overlaps itself.** Each run takes a lock, so a sweep that outlives its interval
 *    delays the next tick rather than racing it.
 *  - **A failure is contained.** Every run is wrapped, so a job that throws logs and leaves the
 *    others (and the process) alone.
 *
 * All seven underlying operations are idempotent, so running them more often than needed — or on
 * more than one instance — produces no duplicates. Even so, prefer `SCHEDULER_ENABLED=false` on all
 * but one instance: duplicate work is wasted work.
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly config: SchedulerConfig;
  private readonly running = new Set<JobName>();
  private readonly lastRuns = new Map<JobName, JobRun>();
  private readonly jobs = new Map<JobName, CronJob>();

  constructor(
    config: ConfigService,
    private readonly registry: SchedulerRegistry,
    private readonly enforcement: EnforcementService,
    private readonly documents: DocumentsService,
    private readonly notifications: NotificationsService,
    private readonly reports: ReportsService,
    private readonly apiClients: ApiClientsService,
    private readonly feeds: FeedsService,
  ) {
    this.config = config.get<SchedulerConfig>('scheduler')!;
  }

  onModuleInit(): void {
    if (!this.config.enabled) {
      this.logger.log('Background jobs are disabled for this process');
      return;
    }
    this.register('compliance-sweep', this.config.complianceSweepCron, () =>
      this.runComplianceSweep(),
    );
    this.register('document-expiry', this.config.documentExpiryCron, () =>
      this.runDocumentExpiry(),
    );
    this.register('notification-retry', this.config.notificationRetryCron, () =>
      this.runNotificationRetry(),
    );
    this.register('penalty-accrual', this.config.penaltyAccrualCron, () =>
      this.runPenaltyAccrual(),
    );
    this.register('scheduled-reports', this.config.scheduledReportsCron, () =>
      this.runScheduledReports(),
    );
    this.register('nonce-sweep', this.config.nonceSweepCron, () => this.runNonceSweep());
    this.register('network-feeds', this.config.networkFeedsCron, () => this.runNetworkFeeds());
  }

  /** Stop the timers on shutdown, so the process can exit cleanly rather than being killed. */
  onModuleDestroy(): void {
    for (const [name, job] of this.jobs) {
      job.stop();
      this.logger.log(`Stopped ${name}`);
    }
    this.jobs.clear();
  }

  private register(name: JobName, cron: string, work: () => Promise<string>): void {
    try {
      const job = new CronJob(cron, () => void this.run(name, work));
      this.registry.addCronJob(name, job as never);
      job.start();
      this.jobs.set(name, job);
      this.logger.log(`Scheduled ${name} (${cron})`);
    } catch {
      // A bad cron expression must not stop the app booting; the other jobs still register.
      this.logger.error(`Could not schedule ${name}: "${cron}" is not a valid cron expression`);
    }
  }

  /**
   * Run one job under a lock, recording the outcome. Public so the jobs can also be triggered by
   * hand from the admin endpoint without duplicating the guard.
   */
  async run(name: JobName, work: () => Promise<string>): Promise<JobRun> {
    const startedAt = new Date();
    if (this.running.has(name)) {
      const skipped: JobRun = {
        name,
        startedAt,
        finishedAt: new Date(),
        ok: true,
        summary: 'Skipped: the previous run has not finished yet.',
      };
      this.logger.warn(`${name} is still running; skipping this tick`);
      this.lastRuns.set(name, skipped);
      return skipped;
    }

    this.running.add(name);
    try {
      const summary = await work();
      const run: JobRun = { name, startedAt, finishedAt: new Date(), ok: true, summary };
      this.logger.log(`${name}: ${summary}`);
      this.lastRuns.set(name, run);
      return run;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const run: JobRun = {
        name,
        startedAt,
        finishedAt: new Date(),
        ok: false,
        summary: message,
      };
      this.logger.error(`${name} failed: ${message}`, err as Error);
      this.lastRuns.set(name, run);
      return run;
    } finally {
      this.running.delete(name);
    }
  }

  // --- The jobs themselves --------------------------------------------------

  runComplianceSweep(): Promise<string> {
    return this.enforcement
      .sweepDue(null, SYSTEM_CONTEXT)
      .then(
        (r) =>
          `Checked ${r.periodsSwept} ${r.periodsSwept === 1 ? 'period' : 'periods'}, opened ${r.casesOpened} ${r.casesOpened === 1 ? 'case' : 'cases'}`,
      );
  }

  runDocumentExpiry(): Promise<string> {
    return this.documents
      .sweepExpiries()
      .then(
        (r) =>
          `Checked ${r.checked} ${r.checked === 1 ? 'document' : 'documents'}, sent ${r.alerted} ${r.alerted === 1 ? 'alert' : 'alerts'}`,
      );
  }

  runNotificationRetry(): Promise<string> {
    return this.notifications
      .retryFailedEmails()
      .then((r) => `Retried ${r.retried} failed ${r.retried === 1 ? 'email' : 'emails'}`);
  }

  runScheduledReports(): Promise<string> {
    return this.reports
      .runDue(null, SYSTEM_CONTEXT)
      .then(
        (r) =>
          `Checked ${r.considered} ${r.considered === 1 ? 'schedule' : 'schedules'}, sent ${r.sent}, failed ${r.failed}`,
      );
  }

  runNetworkFeeds(): Promise<string> {
    return this.feeds
      .runDue(null, SYSTEM_CONTEXT)
      .then(
        (r) =>
          `Checked ${r.considered} ${r.considered === 1 ? 'feed' : 'feeds'}, collected ${r.ran}, failed ${r.failed}, skipped ${r.skipped}`,
      );
  }

  runNonceSweep(): Promise<string> {
    return this.apiClients
      .sweepNonces()
      .then((r) => `Cleared ${r.removed} spent request ${r.removed === 1 ? 'nonce' : 'nonces'}`);
  }

  runPenaltyAccrual(): Promise<string> {
    return this.enforcement
      .accrue(null, SYSTEM_CONTEXT)
      .then(
        (r) =>
          `Reviewed ${r.cases} open ${r.cases === 1 ? 'case' : 'cases'}, updated ${r.accrued}, closed ${r.closed}`,
      );
  }

  /** What each job did last, so the Authority can see the jobs are alive without reading logs. */
  status() {
    const jobs: JobName[] = [
      'compliance-sweep',
      'document-expiry',
      'notification-retry',
      'penalty-accrual',
      'scheduled-reports',
      'nonce-sweep',
      'network-feeds',
    ];
    const cronFor: Record<JobName, string> = {
      'compliance-sweep': this.config.complianceSweepCron,
      'document-expiry': this.config.documentExpiryCron,
      'notification-retry': this.config.notificationRetryCron,
      'penalty-accrual': this.config.penaltyAccrualCron,
      'scheduled-reports': this.config.scheduledReportsCron,
      'nonce-sweep': this.config.nonceSweepCron,
      'network-feeds': this.config.networkFeedsCron,
    };
    return {
      enabled: this.config.enabled,
      jobs: jobs.map((name) => ({
        name,
        cron: cronFor[name],
        running: this.running.has(name),
        lastRun: this.lastRuns.get(name) ?? null,
      })),
    };
  }

  /** Trigger one job by hand. Used by the admin endpoint. */
  trigger(name: JobName): Promise<JobRun> {
    const work: Record<JobName, () => Promise<string>> = {
      'compliance-sweep': () => this.runComplianceSweep(),
      'document-expiry': () => this.runDocumentExpiry(),
      'notification-retry': () => this.runNotificationRetry(),
      'penalty-accrual': () => this.runPenaltyAccrual(),
      'scheduled-reports': () => this.runScheduledReports(),
      'nonce-sweep': () => this.runNonceSweep(),
      'network-feeds': () => this.runNetworkFeeds(),
    };
    return this.run(name, work[name]);
  }
}
