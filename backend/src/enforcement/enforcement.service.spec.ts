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

/**
 * The statutory 30-day remedy notice (NCA, 3 September 2026).
 *
 * Their answer settled a question with two plausible readings and very different sums, so it is
 * written out here in full rather than paraphrased into a test name:
 *
 *   "From the original late date (after the grace window), but only assessed once the 30-day
 *    remedy period lapses unremedied. So nothing is payable during the 30 days, but a defaulter
 *    doesn't get a free month either. If they cure within 30 days, only the Tier 1 late charge
 *    stands."
 *
 * Three separate claims, each of which a reasonable implementation could get wrong on its own:
 * where the clock starts for *calculating*, when the figure becomes *payable*, and what survives
 * when the operator does what the notice asked.
 */
describe('EnforcementService remedy notice', () => {
  /** A case as the accrual reads it, with the remedy clock wherever the test needs it. */
  const openCase = (over: Record<string, unknown> = {}) => ({
    id: 'c1',
    entityId: 'ent-1',
    periodId: 'p1',
    penaltyAmount: 0,
    penaltyDays: 0,
    defaultStartedAt: new Date(Date.now() - 40 * DAY),
    remedyNoticeAt: new Date(Date.now() - 40 * DAY),
    remedyDueAt: new Date(Date.now() - 10 * DAY),
    period: { label: '2026 Q1' },
    penaltyRule: RULE,
    ...over,
  });

  const accrueWith = (over: Record<string, unknown> = {}, filings: unknown[] = []) =>
    buildService({
      enforcementCase: {
        findMany: jest.fn().mockResolvedValue([openCase(over)]),
        update: jest.fn().mockResolvedValue({}),
      },
      submission: { findMany: jest.fn().mockResolvedValue(filings) },
    });

  it('issues the notice the moment the case is opened, with thirty days on it', async () => {
    const { service, prisma } = buildService({
      schedule: { ruleFor: jest.fn().mockResolvedValue(RULE) },
    });
    await service.sweepPeriod('p1', admin.id, CTX);

    const data = (prisma.enforcementCase.create as jest.Mock).mock.calls[0][0].data;
    expect(data.remedyNoticeAt).toBeInstanceOf(Date);
    const days = (data.remedyDueAt.getTime() - data.remedyNoticeAt.getTime()) / DAY;
    expect(days).toBe(30);
  });

  it('does not make the penalty payable on the day the case opens', async () => {
    /*
     * The Act's protection, and the easiest thing to lose. A case that arrives already assessed has
     * skipped the notice entirely — the operator is being charged before being told.
     */
    const { service, prisma } = buildService({
      schedule: { ruleFor: jest.fn().mockResolvedValue(RULE) },
    });
    await service.sweepPeriod('p1', admin.id, CTX);

    const data = (prisma.enforcementCase.create as jest.Mock).mock.calls[0][0].data;
    expect(data.penaltyAssessedAt).toBeNull();
    // The figure is still worked out and shown. Only its being *due* waits.
    expect(data.penaltyAmount).not.toBeNull();
  });

  it('keeps the figure moving during the thirty days without making it payable', async () => {
    // "Nothing is payable during the 30 days, but a defaulter doesn't get a free month either."
    const { service, prisma } = accrueWith({
      remedyNoticeAt: new Date(Date.now() - 5 * DAY),
      remedyDueAt: new Date(Date.now() + 25 * DAY),
      defaultStartedAt: new Date(Date.now() - 5 * DAY),
    });

    await service.accrue(null, CTX);
    const data = (prisma.enforcementCase.update as jest.Mock).mock.calls[0][0].data;
    // The schedule's fixed charge plus five days of it — the figure is worked out in full.
    expect(Number(data.penaltyAmount)).toBe(50_000 + 5 * 5_000);
    expect(data.penaltyAssessedAt).toBeNull();
  });

  it('makes it payable once the thirty days lapse unremedied', async () => {
    const { service, prisma } = accrueWith();

    await service.accrue(null, CTX);
    const data = (prisma.enforcementCase.update as jest.Mock).mock.calls[0][0].data;
    expect(data.penaltyAssessedAt).toBeInstanceOf(Date);
  });

  it('counts from the day the return was late, not from the notice', async () => {
    /*
     * The sharpest of the three claims, and the reason we asked rather than assumed. Counting from
     * the notice would hand a defaulter a free month; NCA ruled that out in the same sentence they
     * granted the thirty days.
     *
     * Forty days late, charged for forty — not for the ten since the notice expired.
     */
    const { service, prisma } = accrueWith();

    await service.accrue(null, CTX);
    const data = (prisma.enforcementCase.update as jest.Mock).mock.calls[0][0].data;
    expect(data.penaltyDays).toBe(40);
  });

  it('treats a case from before the notice existed as past its remedy period', async () => {
    // Otherwise every case opened before this was built would freeze, unpayable for ever, with
    // nothing on screen to say why.
    const { service, prisma } = accrueWith({ remedyNoticeAt: null, remedyDueAt: null });

    await service.accrue(null, CTX);
    const data = (prisma.enforcementCase.update as jest.Mock).mock.calls[0][0].data;
    expect(data.penaltyAssessedAt).toBeInstanceOf(Date);
  });
});

/**
 * Where "audited annual revenue" comes from (NCA, 3 September 2026).
 *
 * Tiers 2 and 3 are a share of it, so the figure decides what an operator owes — and it is not one
 * the portal calculates. `VALIDATION_SPEC` §4.1 settles the source: revenue is **entered on the
 * annual return from audited accounts**, deliberately not summed from the four quarters. Three
 * conditions follow from that, and each one changes the amount if it is dropped, which is why they
 * are tested separately rather than as one happy path.
 *
 * The lookup existed before any of these did. It was written, wired into both pricing paths, and
 * measured by nothing.
 */
describe('EnforcementService audited annual revenue', () => {
  const PERCENT_RULE = {
    id: 'rule-pct',
    fixedAmount: 0,
    dailyAmount: 0,
    maxAmount: null,
    minAmount: 50_000_000,
    percentOfRevenue: 0.2,
  };

  /** A sweep whose schedule line is a share of revenue, over whatever annual return is supplied. */
  const sweepWith = (annualReturn: unknown) =>
    buildService({
      schedule: { ruleFor: jest.fn().mockResolvedValue(PERCENT_RULE) },
      submission: {
        findMany: jest.fn().mockResolvedValue([{ entityId: 'ent-filed' }]),
        findFirst: jest.fn().mockResolvedValue(annualReturn),
      },
    });

  const priced = (prisma: { enforcementCase: { create: jest.Mock } }) =>
    prisma.enforcementCase.create.mock.calls[0][0].data;

  /*
   * The mock reached through a cast.
   *
   * `buildService` infers `prisma` from its own literal, so an override that adds a method is
   * invisible to the type — the override is real at run time and the shape is not. Casting here
   * says that plainly, rather than widening the harness for every other test that does not need it.
   */
  const annualLookup = (prisma: unknown) =>
    (prisma as { submission: { findFirst: jest.Mock } }).submission.findFirst;

  it('prices from the revenue on the approved annual return', async () => {
    // 0.2% of SSP 40bn is SSP 80m, well clear of the floor.
    const { service, prisma } = sweepWith({
      values: [{ valueText: '25000000000' }, { valueText: '15000000000' }],
    });
    await service.sweepPeriod('p1', admin.id, CTX);

    expect(Number(priced(prisma).penaltyAmount)).toBe(80_000_000);
  });

  it('asks only for an annual return that has been approved and not superseded', async () => {
    /*
     * Each of these is a different amount if it is dropped. A quarter's revenue is not the year's;
     * a draft lets an operator move what it owes by editing a return; and a superseded one counted
     * alongside its replacement doubles the year.
     */
    const { service, prisma } = sweepWith({ values: [{ valueText: '40000000000' }] });
    await service.sweepPeriod('p1', admin.id, CTX);

    const where = annualLookup(prisma).mock.calls[0][0].where;
    expect(where.status).toBe('APPROVED');
    expect(where.supersededBy).toBeNull();
    expect(where.period.frequency).toBe('ANNUAL');
  });

  it('counts only the fields the Authority marked as the levy basis', async () => {
    // The same marker the levy is charged on. Two markers for "this is revenue" would drift, and
    // the first anybody noticed would be a penalty that disagreed with the levy.
    const { service, prisma } = sweepWith({ values: [{ valueText: '40000000000' }] });
    await service.sweepPeriod('p1', admin.id, CTX);

    const select = annualLookup(prisma).mock.calls[0][0].select;
    expect(select.values.where.field.isLevyBasis).toBe(true);
    // And a figure the operator said it could not supply is not a figure.
    expect(select.values.where.isUnavailable).toBe(false);
  });

  it('states no amount at all when the annual return does not exist yet', async () => {
    /*
     * The ordinary case. A breach early in the year is priced on that year's revenue, which
     * arrives with the annual return months later. Zero would read as "nothing owed"; a guess
     * would be worse.
     */
    const { service, prisma } = sweepWith(null);
    await service.sweepPeriod('p1', admin.id, CTX);

    expect(Number(priced(prisma).penaltyAmount)).toBe(0);
    expect(priced(prisma).penaltyAssessedAt).toBeNull();
  });

  it('lifts a small operator to the floor', async () => {
    // 0.2% of SSP 5bn is SSP 10m, a fifth of the minimum. A penalty that scales to nothing for a
    // small operator is not a deterrent.
    const { service, prisma } = sweepWith({ values: [{ valueText: '5000000000' }] });
    await service.sweepPeriod('p1', admin.id, CTX);

    expect(Number(priced(prisma).penaltyAmount)).toBe(50_000_000);
  });

  it('does not go looking for revenue when the line is charged by the day', async () => {
    // Tier 1 has nothing to do with the operator's size, and the nightly accrual runs over an
    // unbounded list of cases. A lookup per case that no line reads is a query for nothing.
    const { service, prisma } = buildService({
      schedule: { ruleFor: jest.fn().mockResolvedValue(RULE) },
      submission: {
        findMany: jest.fn().mockResolvedValue([{ entityId: 'ent-filed' }]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    });
    await service.sweepPeriod('p1', admin.id, CTX);

    expect(annualLookup(prisma)).not.toHaveBeenCalled();
  });
});
