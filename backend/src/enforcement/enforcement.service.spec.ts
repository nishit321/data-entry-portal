import { BadRequestException } from '@nestjs/common';
import { EnforcementStatus, EntityType, PeriodStatus, Prisma, Role } from '@prisma/client';
import { EnforcementService } from './enforcement.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

const CTX = { ipAddress: '127.0.0.1', userAgent: 'test', requestId: 'r1' };
const admin: AuthUser = { id: 'admin', email: 'a@nca.ss', role: Role.ADMIN, entityId: null };

/** A period that is overdue (grace ended), with one MNO section on its template. */
function overduePeriod() {
  return {
    id: 'p1',
    label: '2026 Q1',
    status: PeriodStatus.OPEN,
    dueDate: new Date('2000-01-01'),
    graceDays: 5,
    template: { sections: [{ applicableEntityTypes: [EntityType.MNO] }] },
  };
}

function buildService(overrides: Record<string, unknown> = {}) {
  const prisma = {
    reportingPeriod: { findFirst: jest.fn().mockResolvedValue(overduePeriod()) },
    entity: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'ent-filed', name: 'Filed Co', type: EntityType.MNO },
        { id: 'ent-missing', name: 'Missing Co', type: EntityType.MNO },
      ]),
    },
    penaltyRule: { findUnique: jest.fn().mockResolvedValue(null) },
    submission: { findMany: jest.fn().mockResolvedValue([{ entityId: 'ent-filed' }]) },
    enforcementCase: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'case1' }),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    ...overrides,
  };
  delete (prisma as Record<string, unknown>).schedule;
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const notifications = {
    enforcementCaseOpened: jest.fn().mockResolvedValue(undefined),
    enforcementCaseClosed: jest.fn().mockResolvedValue(undefined),
  };
  const schedule = {
    // No schedule line by default, so the sweep tests exercise the unpriced path.
    ruleFor: jest.fn().mockResolvedValue(null),
    ...((overrides.schedule as Record<string, unknown>) ?? {}),
  };
  const service = new EnforcementService(
    prisma as never,
    audit as never,
    notifications as never,
    schedule as never,
  );
  return { service, prisma, audit, notifications, schedule };
}

describe('EnforcementService.sweepPeriod', () => {
  it('opens a case for an expected entity that never filed, and notifies it', async () => {
    const { service, prisma, notifications } = buildService();
    const result = await service.sweepPeriod('p1', admin.id, CTX);

    expect(result.skipped).toBe(false);
    expect(result.opened).toBe(1);
    expect(prisma.enforcementCase.create).toHaveBeenCalledTimes(1);
    expect(prisma.enforcementCase.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ entityId: 'ent-missing' }) }),
    );
    expect(notifications.enforcementCaseOpened).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'ent-missing' }),
    );
  });

  it('skips a period that is still open (grace not ended)', async () => {
    const { service, prisma } = buildService({
      reportingPeriod: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ ...overduePeriod(), dueDate: new Date('2999-01-01') }),
      },
    });
    const result = await service.sweepPeriod('p1', admin.id, CTX);
    expect(result.skipped).toBe(true);
    expect(prisma.enforcementCase.create).not.toHaveBeenCalled();
  });

  it('is idempotent: does not reopen an existing case', async () => {
    const { service, prisma } = buildService({
      enforcementCase: {
        findUnique: jest.fn().mockResolvedValue({ id: 'existing' }),
        create: jest.fn(),
      },
    });
    const result = await service.sweepPeriod('p1', admin.id, CTX);
    expect(result.opened).toBe(0);
    expect(prisma.enforcementCase.create).not.toHaveBeenCalled();
  });

  it('opens nothing when the template applies to no entity types', async () => {
    const { service, prisma } = buildService({
      reportingPeriod: {
        findFirst: jest.fn().mockResolvedValue({ ...overduePeriod(), template: { sections: [] } }),
      },
    });
    const result = await service.sweepPeriod('p1', admin.id, CTX);
    expect(result.opened).toBe(0);
    expect(prisma.entity.findMany).not.toHaveBeenCalled();
  });
});

describe('EnforcementService case actions', () => {
  it('resolves an open case', async () => {
    const { service, prisma, notifications } = buildService({
      enforcementCase: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'c1',
          status: EnforcementStatus.OPEN,
          entityId: 'ent-1',
          period: { label: '2026 Q1' },
        }),
        update: jest.fn().mockResolvedValue({ id: 'c1', status: EnforcementStatus.RESOLVED }),
      },
    });
    await service.resolve(admin, 'c1', { note: 'They have since filed' }, CTX);
    expect(prisma.enforcementCase.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: EnforcementStatus.RESOLVED }),
      }),
    );
    expect(notifications.enforcementCaseClosed).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'ent-1', waived: false }),
    );
  });

  it('refuses to close a case that is not open', async () => {
    const { service } = buildService({
      enforcementCase: {
        findUnique: jest.fn().mockResolvedValue({ id: 'c1', status: EnforcementStatus.RESOLVED }),
        update: jest.fn(),
      },
    });
    await expect(service.waive(admin, 'c1', {}, CTX)).rejects.toBeInstanceOf(BadRequestException);
  });
});

/** A schedule line: 50,000 on day one, then 5,000 a day, capped at 200,000. */
const RULE = {
  id: 'rule-1',
  fixedAmount: 50_000,
  dailyAmount: 5_000,
  maxAmount: 200_000,
};

const DAY = 86_400_000;

describe('EnforcementService penalty automation', () => {
  it('prices a case under the schedule in force when the default began', async () => {
    const { service, prisma } = buildService({
      schedule: { ruleFor: jest.fn().mockResolvedValue(RULE) },
    });
    await service.sweepPeriod('p1', admin.id, CTX);

    const data = (prisma.enforcementCase.create as jest.Mock).mock.calls[0][0].data;
    expect(data.penaltyRuleId).toBe('rule-1');
    expect(data.defaultStartedAt).toBeInstanceOf(Date);
    // The due date is in 2000, so the cap has long since bitten.
    expect(Number(data.penaltyAmount)).toBe(200_000);
  });

  it('still opens the case when NCA has entered no schedule yet', async () => {
    const { service, prisma } = buildService();
    const result = await service.sweepPeriod('p1', admin.id, CTX);

    expect(result.opened).toBe(1);
    const data = (prisma.enforcementCase.create as jest.Mock).mock.calls[0][0].data;
    expect(data.penaltyRuleId).toBeNull();
    expect(data.penaltyAmount).toBeNull();
  });

  it('accrues the daily amount on a case whose return is still missing', async () => {
    const started = new Date(Date.now() - 4 * DAY);
    const { service, prisma } = buildService({
      enforcementCase: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'c1',
            entityId: 'ent-1',
            periodId: 'p1',
            penaltyAmount: 50_000,
            penaltyDays: 0,
            defaultStartedAt: started,
            period: { label: '2026 Q1' },
            penaltyRule: RULE,
          },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
      submission: { findMany: jest.fn().mockResolvedValue([]) },
    });

    const result = await service.accrue(null, CTX);
    expect(result).toMatchObject({ cases: 1, accrued: 1, closed: 0 });
    const data = (prisma.enforcementCase.update as jest.Mock).mock.calls[0][0].data;
    expect(Number(data.penaltyAmount)).toBe(50_000 + 4 * 5_000);
    expect(data.penaltyDays).toBe(4);
  });

  it('closes a case by itself once the missing return arrives, and freezes the amount', async () => {
    const started = new Date(Date.now() - 10 * DAY);
    const filed = new Date(Date.now() - 7 * DAY);
    const { service, prisma, notifications } = buildService({
      enforcementCase: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'c1',
            entityId: 'ent-1',
            periodId: 'p1',
            penaltyAmount: 50_000,
            penaltyDays: 0,
            defaultStartedAt: started,
            period: { label: '2026 Q1' },
            penaltyRule: RULE,
          },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
      submission: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ entityId: 'ent-1', periodId: 'p1', submittedAt: filed }]),
      },
    });

    const result = await service.accrue(null, CTX);
    expect(result).toMatchObject({ closed: 1, accrued: 0 });

    const data = (prisma.enforcementCase.update as jest.Mock).mock.calls[0][0].data;
    expect(data.status).toBe(EnforcementStatus.RESOLVED);
    expect(data.defaultEndedAt).toEqual(filed);
    // Three days of default, not the ten that have elapsed since it began.
    expect(data.penaltyDays).toBe(3);
    expect(Number(data.penaltyAmount)).toBe(50_000 + 3 * 5_000);
    expect(notifications.enforcementCaseClosed).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'ent-1', waived: false }),
    );
  });

  it('leaves an unchanged amount alone rather than writing every night', async () => {
    const started = new Date(Date.now() - 2 * DAY);
    const { service, prisma } = buildService({
      enforcementCase: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'c1',
            entityId: 'ent-1',
            periodId: 'p1',
            penaltyAmount: 50_000 + 2 * 5_000,
            penaltyDays: 2,
            defaultStartedAt: started,
            period: { label: '2026 Q1' },
            penaltyRule: RULE,
          },
        ]),
        update: jest.fn(),
      },
      submission: { findMany: jest.fn().mockResolvedValue([]) },
    });

    const result = await service.accrue(null, CTX);
    expect(result.accrued).toBe(0);
    expect(prisma.enforcementCase.update).not.toHaveBeenCalled();
  });

  it('does nothing when there are no open cases', async () => {
    const { service, prisma } = buildService({
      enforcementCase: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    });
    const result = await service.accrue(null, CTX);
    expect(result).toEqual({ cases: 0, accrued: 0, closed: 0 });
    expect(prisma.submission.findMany).not.toHaveBeenCalled();
  });
});

describe('EnforcementService sweep resilience', () => {
  it('steps over a case that another sweep has already opened', async () => {
    const clash = Object.assign(new Error('unique'), { code: 'P2002' });
    Object.setPrototypeOf(clash, Prisma.PrismaClientKnownRequestError.prototype);
    const { service, prisma } = buildService({
      enforcementCase: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockRejectedValue(clash),
      },
    });

    const result = await service.sweepPeriod('p1', admin.id, CTX);
    expect(result.opened).toBe(0);
    expect(result.skipped).toBe(false);
    expect(prisma.enforcementCase.create).toHaveBeenCalledTimes(1);
  });

  it('carries on with the other periods when one of them fails', async () => {
    const { service } = buildService({
      reportingPeriod: {
        findMany: jest.fn().mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]),
        findFirst: jest
          .fn()
          .mockRejectedValueOnce(new Error('database went away'))
          .mockResolvedValue(overduePeriod()),
      },
    });

    const result = await service.sweepDue(null, CTX);
    // One period blew up; the other was still swept and its case opened.
    expect(result.periodsFailed).toBe(1);
    expect(result.periodsSwept).toBe(1);
    expect(result.casesOpened).toBe(1);
  });
});
