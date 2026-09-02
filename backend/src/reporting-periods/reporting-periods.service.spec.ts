import { BadRequestException } from '@nestjs/common';
import { AuditAction, PeriodStatus, ReportingFrequency, TemplateStatus } from '@prisma/client';
import { ReportingPeriodsService } from './reporting-periods.service';
import { CreatePeriodDto } from './dto/period.dto';

function buildService() {
  const prisma = {
    reportingTemplate: { findFirst: jest.fn() },
    reportingPeriod: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const enforcement = { sweepPeriod: jest.fn().mockResolvedValue({ skipped: false, opened: 0 }) };
  const service = new ReportingPeriodsService(
    prisma as never,
    audit as never,
    enforcement as never,
  );
  return { service, prisma, audit, enforcement };
}

const baseDto: CreatePeriodDto = {
  templateId: '11111111-1111-1111-1111-111111111111',
  frequency: ReportingFrequency.QUARTERLY,
  label: '2026 Q1',
  periodStart: '2026-01-01',
  periodEnd: '2026-03-31',
  dueDate: '2026-04-15',
};

const periodRow = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  templateId: baseDto.templateId,
  frequency: ReportingFrequency.QUARTERLY,
  label: '2026 Q1',
  periodStart: new Date('2026-01-01'),
  periodEnd: new Date('2026-03-31'),
  dueDate: new Date('2026-04-15'),
  graceDays: 5,
  status: PeriodStatus.OPEN,
  openedAt: new Date(),
  closedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  template: { id: baseDto.templateId, name: 'T', version: 1 },
  ...over,
});

describe('ReportingPeriodsService', () => {
  it('rejects opening a period against a non-published template', async () => {
    const { service, prisma } = buildService();
    prisma.reportingTemplate.findFirst.mockResolvedValue({ id: 't', status: TemplateStatus.DRAFT });
    await expect(service.create(baseDto, 'admin', {})).rejects.toThrow(BadRequestException);
    expect(prisma.reportingPeriod.create).not.toHaveBeenCalled();
  });

  it('rejects mis-ordered dates', async () => {
    const { service, prisma } = buildService();
    prisma.reportingTemplate.findFirst.mockResolvedValue({
      id: 't',
      status: TemplateStatus.PUBLISHED,
    });
    await expect(
      service.create(
        { ...baseDto, periodStart: '2026-04-01', periodEnd: '2026-01-01' },
        'admin',
        {},
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('creates an OPEN period and audits it', async () => {
    const { service, prisma, audit } = buildService();
    prisma.reportingTemplate.findFirst.mockResolvedValue({
      id: 't',
      status: TemplateStatus.PUBLISHED,
    });
    prisma.reportingPeriod.create.mockResolvedValue(periodRow());
    const result = await service.create(baseDto, 'admin', {});
    expect(prisma.reportingPeriod.create).toHaveBeenCalled();
    expect(result.timeline).toBeDefined();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.PERIOD_CREATED }),
    );
  });

  it('computes an "open" phase before the due date and "overdue" long after', async () => {
    const { service, prisma } = buildService();
    prisma.reportingPeriod.findFirst.mockResolvedValueOnce(
      periodRow({ dueDate: new Date('2999-01-01') }),
    );
    expect((await service.findOne('p1')).timeline.phase).toBe('open');

    prisma.reportingPeriod.findFirst.mockResolvedValueOnce(
      periodRow({ dueDate: new Date('2000-01-01') }),
    );
    expect((await service.findOne('p1')).timeline.phase).toBe('overdue');
  });

  it('closes a period and audits it', async () => {
    const { service, prisma, audit } = buildService();
    prisma.reportingPeriod.findFirst.mockResolvedValue(periodRow());
    prisma.reportingPeriod.update.mockResolvedValue(periodRow({ status: PeriodStatus.CLOSED }));
    await service.close('p1', 'admin', {});
    expect(prisma.reportingPeriod.update.mock.calls[0][0].data.status).toBe(PeriodStatus.CLOSED);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.PERIOD_CLOSED }),
    );
  });
});
