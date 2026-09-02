import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { EntityStatus, PeriodStatus, Role, SubmissionStatus, TemplateStatus } from '@prisma/client';
import { SubmissionsService } from './submissions.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { SubmissionQueryDto } from './dto/submission.dto';

const ENTITY_A = '11111111-1111-1111-1111-111111111111';
const ENTITY_B = '22222222-2222-2222-2222-222222222222';

function buildService() {
  const prisma = {
    reportingPeriod: { findFirst: jest.fn(), findMany: jest.fn().mockReturnValue([]) },
    // Entities are ACTIVE by default; individual tests override this to test the status gate.
    entity: { findFirst: jest.fn().mockResolvedValue({ status: EntityStatus.ACTIVE }) },
    submission: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockReturnValue([]),
      count: jest.fn().mockReturnValue(0),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const notifications = {
    returnAwaitingReview: jest.fn().mockResolvedValue(undefined),
    returnDecision: jest.fn().mockResolvedValue(undefined),
  };
  const storage = {
    copy: jest.fn().mockResolvedValue('key/copy'),
    save: jest.fn(),
    stream: jest.fn(),
    remove: jest.fn(),
  };
  // A stub for the certificate signature path (Q6, Phase 3). These specs exercise the simple
  // signature, so it is never reached; it is here so the constructor is satisfied.
  const signatures = {
    resolveSigningCertificate: jest.fn(),
    digestOf: jest.fn().mockReturnValue('digest'),
  };
  const service = new SubmissionsService(
    prisma as never,
    audit as never,
    signatures as never,
    notifications as never,
    storage as never,
  );
  return { service, prisma };
}

const operator = (entityId: string | null): AuthUser => ({
  id: 'op',
  email: 'op@x.ss',
  role: Role.OPERATOR_ADMIN,
  entityId,
});
const admin: AuthUser = { id: 'a', email: 'a@x.ss', role: Role.ADMIN, entityId: null };
const query = (over: Partial<SubmissionQueryDto> = {}): SubmissionQueryDto =>
  ({ page: 1, pageSize: 20, order: 'desc', sort: 'createdAt', ...over }) as SubmissionQueryDto;

describe('SubmissionsService', () => {
  it('forbids a non-operator from creating a draft', async () => {
    const { service } = buildService();
    await expect(service.getOrCreateDraft(admin, { periodId: 'p' }, {})).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects opening a draft against a period that is not OPEN', async () => {
    const { service, prisma } = buildService();
    prisma.reportingPeriod.findFirst.mockResolvedValue({
      id: 'p',
      status: PeriodStatus.CLOSED,
      templateId: 't',
      template: { status: TemplateStatus.PUBLISHED },
    });
    await expect(
      service.getOrCreateDraft(operator(ENTITY_A), { periodId: 'p' }, {}),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.submission.create).not.toHaveBeenCalled();
  });

  it('stops a non-active entity from starting a draft', async () => {
    const { service, prisma } = buildService();
    prisma.entity.findFirst.mockResolvedValue({ status: EntityStatus.SUSPENDED });
    await expect(
      service.getOrCreateDraft(operator(ENTITY_A), { periodId: 'p' }, {}),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.reportingPeriod.findFirst).not.toHaveBeenCalled();
    expect(prisma.submission.create).not.toHaveBeenCalled();
  });

  it('offers no startable periods to a non-active entity', async () => {
    const { service, prisma } = buildService();
    prisma.entity.findFirst.mockResolvedValue({
      type: 'MNO',
      status: EntityStatus.SUSPENDED,
    });
    await expect(service.startablePeriods(operator(ENTITY_A))).resolves.toEqual([]);
    expect(prisma.reportingPeriod.findMany).not.toHaveBeenCalled();
  });

  it('scopes an operator list to its own entity, ignoring a spoofed entityId', async () => {
    const { service, prisma } = buildService();
    await service.findAll(operator(ENTITY_A), query({ entityId: ENTITY_B }));
    expect(prisma.submission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ entityId: ENTITY_A }) }),
    );
  });

  it('refuses to delete a submitted return', async () => {
    const { service, prisma } = buildService();
    prisma.submission.findFirst.mockResolvedValue({
      id: 's1',
      entityId: ENTITY_A,
      status: SubmissionStatus.SUBMITTED,
    });
    await expect(service.remove(operator(ENTITY_A), 's1', {})).rejects.toThrow(BadRequestException);
    expect(prisma.submission.update).not.toHaveBeenCalled();
  });
});
