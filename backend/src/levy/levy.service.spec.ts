import { BadRequestException } from '@nestjs/common';
import { EntityType, Role } from '@prisma/client';
import { LevyService } from './levy.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

const CTX = { ipAddress: '127.0.0.1', userAgent: 'test', requestId: 'r1' };
const admin: AuthUser = { id: 'admin', email: 'a@nca.ss', role: Role.ADMIN, entityId: null };
const operator: AuthUser = {
  id: 'op',
  email: 'o@x.ss',
  role: Role.OPERATOR_ADMIN,
  entityId: 'ent-1',
};

const PERIOD = {
  id: 'p1',
  label: '2026 Q1',
  dueDate: new Date('2026-04-15'),
  template: { name: 'MNO Return', sections: [{ fields: [{ id: 'rev-field' }] }] },
};

function buildService(over: Record<string, unknown> = {}) {
  const prisma = {
    reportingPeriod: { findFirst: jest.fn().mockResolvedValue(PERIOD) },
    levyRate: {
      findFirst: jest.fn().mockResolvedValue({ id: 'rate1', ratePercent: 2.5, label: '2026 levy' }),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    submission: {
      findFirst: jest.fn().mockResolvedValue({ periodId: 'p1' }),
      findMany: jest.fn().mockResolvedValue([
        {
          entity: { id: 'ent-1', name: 'Acme', type: EntityType.MNO },
          values: [{ valueText: '1000000' }, { valueText: '500000' }],
        },
      ]),
    },
    ...over,
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new LevyService(prisma as never, audit as never);
  return { service, prisma, audit };
}

describe('LevyService.assessments', () => {
  it('assesses revenue times the applicable rate', async () => {
    const { service } = buildService();
    const result = await service.assessments(admin, { periodId: 'p1' });

    expect(result.levyBasisConfigured).toBe(true);
    expect(result.rate).toMatchObject({ ratePercent: 2.5 });
    expect(result.rows).toHaveLength(1);
    // Revenue 1,500,000 × 2.5% = 37,500.
    expect(result.rows[0].assessableRevenue).toBe(1500000);
    expect(result.rows[0].levyDue).toBe(37500);
    expect(result.totals).toMatchObject({
      operatorsAssessed: 1,
      totalRevenue: 1500000,
      totalLevyDue: 37500,
    });
  });

  it('returns a null levy when no rate covers the period', async () => {
    const { service } = buildService({
      levyRate: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    const result = await service.assessments(admin, { periodId: 'p1' });
    expect(result.rate).toBeNull();
    expect(result.rows[0].levyDue).toBeNull();
    expect(result.totals.totalLevyDue).toBeNull();
  });

  it('flags when the template has no levy-basis field', async () => {
    const { service } = buildService({
      reportingPeriod: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ ...PERIOD, template: { ...PERIOD.template, sections: [] } }),
      },
      submission: {
        // When there is no levy-basis field, the query omits `values` entirely.
        findMany: jest
          .fn()
          .mockResolvedValue([{ entity: { id: 'ent-1', name: 'Acme', type: EntityType.MNO } }]),
      },
    });
    const result = await service.assessments(admin, { periodId: 'p1' });
    expect(result.levyBasisConfigured).toBe(false);
    expect(result.rows[0].assessableRevenue).toBe(0);
  });

  it('forces an operator to their own entity scope', async () => {
    const { service, prisma } = buildService();
    await service.assessments(operator, { periodId: 'p1', entityId: 'someone-else' });
    const call = (prisma.submission.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where.entityId).toBe('ent-1');
    expect(call.where.status).toBe('APPROVED');
    expect(call.where.supersededBy).toBeNull();
  });

  it('returns an empty result when there is nothing to assess', async () => {
    const { service } = buildService({
      submission: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn() },
    });
    const result = await service.assessments(admin, {});
    expect(result.period).toBeNull();
    expect(result.rows).toEqual([]);
  });
});

describe('LevyService rate config', () => {
  it('rejects a window whose end is not after its start', async () => {
    const { service } = buildService();
    await expect(
      service.createRate(
        { ratePercent: 2, effectiveFrom: '2026-01-01', effectiveTo: '2025-12-31' },
        admin.id,
        CTX,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates a rate and audits it', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'rate1', ratePercent: 2, label: null });
    const { service, audit } = buildService({
      levyRate: { create, findFirst: jest.fn(), findMany: jest.fn() },
    });
    await service.createRate({ ratePercent: 2, effectiveFrom: '2026-01-01' }, admin.id, CTX);
    expect(create).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'LEVY_RATE_CREATED' }),
    );
  });
});
