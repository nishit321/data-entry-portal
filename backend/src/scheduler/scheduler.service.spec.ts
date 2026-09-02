import { SchedulerService } from './scheduler.service';

const CRON = {
  enabled: true,
  complianceSweepCron: '0 2 * * *',
  documentExpiryCron: '30 2 * * *',
  notificationRetryCron: '15 * * * *',
  penaltyAccrualCron: '45 2 * * *',
  scheduledReportsCron: '5 * * * *',
  nonceSweepCron: '20,50 * * * *',
  networkFeedsCron: '10 * * * *',
};

function buildService(over: Partial<typeof CRON> = {}) {
  const config = { get: jest.fn().mockReturnValue({ ...CRON, ...over }) };
  const registry = { addCronJob: jest.fn() };
  const enforcement = {
    sweepDue: jest.fn().mockResolvedValue({ periodsSwept: 3, casesOpened: 1 }),
    accrue: jest.fn().mockResolvedValue({ cases: 2, accrued: 1, closed: 1 }),
  };
  const documents = {
    sweepExpiries: jest.fn().mockResolvedValue({ checked: 5, alerted: 2 }),
  };
  const notifications = { retryFailedEmails: jest.fn().mockResolvedValue({ retried: 4 }) };
  const reports = {
    runDue: jest.fn().mockResolvedValue({ considered: 3, sent: 1, failed: 0 }),
  };
  const apiClients = { sweepNonces: jest.fn().mockResolvedValue({ removed: 7 }) };
  const feeds = {
    runDue: jest.fn().mockResolvedValue({ considered: 4, ran: 2, failed: 1, skipped: 1 }),
  };
  const service = new SchedulerService(
    config as never,
    registry as never,
    enforcement as never,
    documents as never,
    notifications as never,
    reports as never,
    apiClients as never,
    feeds as never,
  );
  return {
    service,
    registry,
    enforcement,
    documents,
    notifications,
    reports,
    apiClients,
    feeds,
  };
}

describe('SchedulerService registration', () => {
  it('registers every job when enabled', () => {
    const { service, registry } = buildService();
    service.onModuleInit();
    expect(registry.addCronJob).toHaveBeenCalledTimes(7);
    expect(registry.addCronJob.mock.calls.map((c) => c[0])).toEqual([
      'compliance-sweep',
      'document-expiry',
      'notification-retry',
      'penalty-accrual',
      'scheduled-reports',
      'nonce-sweep',
      'network-feeds',
    ]);
    // Shutting down stops the timers, so nothing is left running behind the process.
    service.onModuleDestroy();
  });

  it('registers nothing when the scheduler is switched off', () => {
    const { service, registry } = buildService({ enabled: false });
    service.onModuleInit();
    expect(registry.addCronJob).not.toHaveBeenCalled();
  });

  it('still boots when one cron expression is invalid', () => {
    const { service, registry } = buildService({ complianceSweepCron: 'not a cron' });
    expect(() => service.onModuleInit()).not.toThrow();
    // Every valid job is still scheduled.
    expect(registry.addCronJob.mock.calls.map((c) => c[0])).toEqual([
      'document-expiry',
      'notification-retry',
      'penalty-accrual',
      'scheduled-reports',
      'nonce-sweep',
      'network-feeds',
    ]);
    service.onModuleDestroy();
  });
});

describe('SchedulerService.run', () => {
  it('reports what a job did', async () => {
    const { service } = buildService();
    const run = await service.trigger('compliance-sweep');
    expect(run.ok).toBe(true);
    expect(run.summary).toBe('Checked 3 periods, opened 1 case');
  });

  it('contains a failure rather than letting it escape', async () => {
    const { service, documents } = buildService();
    documents.sweepExpiries.mockRejectedValue(new Error('database is down'));

    const run = await service.trigger('document-expiry');
    expect(run.ok).toBe(false);
    expect(run.summary).toBe('database is down');
    // The failure is recorded rather than thrown, so the next tick still fires.
    expect(service.status().jobs.find((j) => j.name === 'document-expiry')?.lastRun?.ok).toBe(
      false,
    );
  });

  it('does not let a job overlap itself', async () => {
    const { service, notifications } = buildService();
    // Hold the first run open so the second arrives while it is still going.
    let release!: () => void;
    notifications.retryFailedEmails.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ retried: 1 });
      }),
    );

    const first = service.trigger('notification-retry');
    const second = await service.trigger('notification-retry');
    expect(second.summary).toMatch(/not finished yet/);
    // The held job ran once, not twice.
    expect(notifications.retryFailedEmails).toHaveBeenCalledTimes(1);

    release();
    await first;

    // Once it is free, the job runs again normally.
    notifications.retryFailedEmails.mockResolvedValue({ retried: 2 });
    const third = await service.trigger('notification-retry');
    expect(third.summary).toBe('Retried 2 failed emails');
  });

  it('uses singular wording for a count of one', async () => {
    const { service, notifications } = buildService();
    notifications.retryFailedEmails.mockResolvedValue({ retried: 1 });
    const run = await service.trigger('notification-retry');
    expect(run.summary).toBe('Retried 1 failed email');
  });
});

describe('SchedulerService.status', () => {
  it('lists every job with its schedule, before anything has run', () => {
    const { service } = buildService();
    const status = service.status();
    expect(status.enabled).toBe(true);
    expect(status.jobs).toHaveLength(7);
    expect(status.jobs[0]).toMatchObject({
      name: 'compliance-sweep',
      cron: '0 2 * * *',
      running: false,
      lastRun: null,
    });
  });

  it('records the last run once a job has fired', async () => {
    const { service } = buildService();
    await service.trigger('document-expiry');
    const job = service.status().jobs.find((j) => j.name === 'document-expiry');
    expect(job?.lastRun?.summary).toBe('Checked 5 documents, sent 2 alerts');
  });
});

describe('SchedulerService.runPenaltyAccrual', () => {
  it('reports what the nightly penalty run did', async () => {
    const { service, enforcement } = buildService();
    const summary = await service.runPenaltyAccrual();
    expect(enforcement.accrue).toHaveBeenCalledWith(null, expect.any(Object));
    expect(summary).toBe('Reviewed 2 open cases, updated 1, closed 1');
  });
});

describe('SchedulerService.runScheduledReports', () => {
  it('reports what the hourly report check did', async () => {
    const { service, reports } = buildService();
    const summary = await service.runScheduledReports();
    expect(reports.runDue).toHaveBeenCalledWith(null, expect.any(Object));
    expect(summary).toBe('Checked 3 schedules, sent 1, failed 0');
  });
});

describe('SchedulerService.runNonceSweep', () => {
  it('reports how many spent nonces it cleared', async () => {
    const { service, apiClients } = buildService();
    const summary = await service.runNonceSweep();
    expect(apiClients.sweepNonces).toHaveBeenCalled();
    expect(summary).toBe('Cleared 7 spent request nonces');
  });
});

describe('SchedulerService.runNetworkFeeds', () => {
  it('reports what the hourly feed pull did', async () => {
    const { service, feeds } = buildService();
    const summary = await service.runNetworkFeeds();
    expect(feeds.runDue).toHaveBeenCalledWith(null, expect.any(Object));
    expect(summary).toBe('Checked 4 feeds, collected 2, failed 1, skipped 1');
  });
});
