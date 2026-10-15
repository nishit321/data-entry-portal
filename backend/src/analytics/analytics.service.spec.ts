import { EntityType, Role, SubmissionStatus } from '@prisma/client';
import { AnalyticsService } from './analytics.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

const operator: AuthUser = {
  id: 'op1',
  email: 'op@x.ss',
  role: Role.OPERATOR_ADMIN,
  entityId: 'ent-1',
};
const admin: AuthUser = { id: 'a', email: 'a@x.ss', role: Role.ADMIN, entityId: null };

function buildService(submissionGroupBy: jest.Mock, caseGroupBy = jest.fn().mockResolvedValue([])) {
  const prisma = {
    submission: { groupBy: submissionGroupBy },
    enforcementCase: { groupBy: caseGroupBy },
    reportingPeriod: { findMany: jest.fn().mockResolvedValue([]) },
    entity: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new AnalyticsService(prisma as never);
  return { service, prisma };
}

/** A period as the trend query reads it, addressed to the given operator types. */
function period(id: string, label: string, dueDate: string, types: EntityType[]) {
  return {
    id,
    label,
    dueDate: new Date(dueDate),
    template: { sections: [{ applicableEntityTypes: types }] },
  };
}

describe('AnalyticsService.summary', () => {
  it('shapes the aggregates and computes the approval rate', async () => {
    // Route each groupBy call to a canned result by its `by` dimension.
    const groupBy = jest.fn().mockImplementation((args: { by: string[] }) => {
      if (args.by.includes('status')) {
        return Promise.resolve([
          { status: SubmissionStatus.APPROVED, _count: 3 },
          { status: SubmissionStatus.REJECTED, _count: 1 },
          { status: SubmissionStatus.DRAFT, _count: 2 },
        ]);
      }
      if (args.by.includes('isLate')) {
        return Promise.resolve([
          { isLate: false, _count: 3 },
          { isLate: true, _count: 1 },
        ]);
      }
      if (args.by.includes('reviewStage')) {
        return Promise.resolve([{ reviewStage: 'CHECKER', _count: 1 }]);
      }
      return Promise.resolve([]);
    });
    const caseGroupBy = jest.fn().mockResolvedValue([{ status: 'OPEN', _count: 2 }]);
    const { service } = buildService(groupBy, caseGroupBy);

    const result = await service.summary(admin, {});
    expect(result.submissions).toEqual({
      total: 6,
      draft: 2,
      submitted: 0,
      underReview: 0,
      approved: 3,
      rejected: 1,
    });
    expect(result.timeliness).toEqual({ onTime: 3, late: 1 });
    expect(result.pipeline.checker).toBe(1);
    expect(result.compliance.open).toBe(2);
    expect(result.approvalRate).toBeCloseTo(0.75);
  });

  it('returns a null approval rate when nothing has been decided', async () => {
    const groupBy = jest.fn().mockResolvedValue([]);
    const { service } = buildService(groupBy);
    const result = await service.summary(admin, {});
    expect(result.approvalRate).toBeNull();
    expect(result.submissions.total).toBe(0);
  });

  it('forces an operator to their own entity scope', async () => {
    const groupBy = jest.fn().mockResolvedValue([]);
    const { service } = buildService(groupBy);
    await service.summary(operator, { entityId: 'someone-else' });
    // The status groupBy must be scoped to the operator's own entity, not the requested one.
    const statusCall = groupBy.mock.calls.find((c) => c[0].by.includes('status'));
    expect(statusCall[0].where.entityId).toBe('ent-1');
    expect(statusCall[0].where.supersededBy).toBeNull();
  });
});

describe('AnalyticsService.trends', () => {
  it('assembles a per-period series oldest to newest', async () => {
    const submissionGroupBy = jest.fn().mockImplementation((args: { by: string[] }) => {
      if (args.by.includes('status')) {
        return Promise.resolve([{ periodId: 'p1', status: SubmissionStatus.APPROVED, _count: 2 }]);
      }
      return Promise.resolve([
        { periodId: 'p1', isLate: false, _count: 2 },
        { periodId: 'p2', isLate: true, _count: 1 },
      ]);
    });
    const { service, prisma } = buildService(submissionGroupBy);
    // Returned newest-first by the query; the service reverses to oldest-first.
    prisma.reportingPeriod.findMany.mockResolvedValue([
      period('p2', '2026 Q2', '2026-07-15', [EntityType.MNO]),
      period('p1', '2026 Q1', '2026-04-15', [EntityType.MNO]),
    ]);

    const { periods } = await service.trends(admin, { periods: 8 });
    expect(periods.map((p) => p.label)).toEqual(['2026 Q1', '2026 Q2']);
    expect(periods[0]).toMatchObject({ filed: 2, onTime: 2, late: 0, approved: 2 });
    expect(periods[1]).toMatchObject({ filed: 1, onTime: 0, late: 1 });
  });

  it('holds each period to the operators it was addressed to', async () => {
    /*
     * A chart that spans questionnaires is where the obligation count can quietly go wrong. Two
     * periods here: one written for mobile operators, one for internet providers. Every active
     * operator of either type comes back from the one query that fetches them, so counting the
     * whole list against both periods would tell the mobile period that internet providers owed it
     * a return, and show missed filings that were never due.
     */
    const { service, prisma } = buildService(jest.fn().mockResolvedValue([]));
    prisma.reportingPeriod.findMany.mockResolvedValue([
      period('isp-q1', 'ISP Q1', '2026-04-15', [EntityType.ISP]),
      period('mno-q1', 'MNO Q1', '2026-04-15', [EntityType.MNO]),
    ]);
    prisma.entity.findMany.mockResolvedValue([
      { id: 'e1', type: EntityType.MNO },
      { id: 'e2', type: EntityType.MNO },
      { id: 'e3', type: EntityType.ISP },
    ]);

    const { periods } = await service.trends(admin, { periods: 8 });
    const byLabel = Object.fromEntries(periods.map((p) => [p.label, p]));
    expect(byLabel['MNO Q1']).toMatchObject({ expected: 2, notFiled: 2 });
    expect(byLabel['ISP Q1']).toMatchObject({ expected: 1, notFiled: 1 });
  });

  it('never reports a negative shortfall', async () => {
    // An operator that filed and then had its licence suspended is still counted among the filings
    // but no longer owes anything. That is nobody missing, not minus one.
    const submissionGroupBy = jest.fn().mockImplementation((args: { by: string[] }) => {
      if (args.by.includes('isLate')) {
        return Promise.resolve([{ periodId: 'p1', isLate: false, _count: 2 }]);
      }
      return Promise.resolve([]);
    });
    const { service, prisma } = buildService(submissionGroupBy);
    prisma.reportingPeriod.findMany.mockResolvedValue([
      period('p1', '2026 Q1', '2026-04-15', [EntityType.MNO]),
    ]);
    prisma.entity.findMany.mockResolvedValue([{ id: 'e1', type: EntityType.MNO }]);

    const { periods } = await service.trends(admin, { periods: 8 });
    expect(periods[0]).toMatchObject({ filed: 2, expected: 1, notFiled: 0 });
  });

  it('returns an empty series when there are no periods', async () => {
    const { service } = buildService(jest.fn().mockResolvedValue([]));
    const result = await service.trends(admin, { periods: 8 });
    expect(result.periods).toEqual([]);
  });
});
