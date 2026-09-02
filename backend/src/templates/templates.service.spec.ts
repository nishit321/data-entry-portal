import { BadRequestException } from '@nestjs/common';
import { AuditAction, ReportingFrequency, TemplateStatus } from '@prisma/client';
import { TemplatesService } from './templates.service';
import { CreateSectionDto } from './dto/section.dto';

function buildService() {
  const prisma = {
    reportingTemplate: {
      findFirst: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 't1', name: 'T', sections: [] }),
      update: jest.fn().mockResolvedValue({ id: 't1' }),
    },
    templateSection: { create: jest.fn() },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new TemplatesService(prisma as never, audit as never);
  return { service, prisma, audit };
}

const section: CreateSectionDto = {
  key: 'general',
  title: 'General',
  applicableEntityTypes: ['MNO'] as never,
  frequency: ReportingFrequency.QUARTERLY_AND_ANNUAL,
};

describe('TemplatesService', () => {
  it('creates a v1 draft and audits it', async () => {
    const { service, prisma, audit } = buildService();
    await service.create({ name: 'ICT Return' }, 'admin', {});
    expect(prisma.reportingTemplate.create.mock.calls[0][0].data.version).toBe(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.TEMPLATE_CREATED }),
    );
  });

  it('refuses to delete a template that periods or submissions still reference', async () => {
    const { service, prisma } = buildService();
    prisma.reportingTemplate.findFirst.mockResolvedValue({
      id: 't1',
      name: 'T',
      _count: { periods: 1, submissions: 0 },
    });
    await expect(service.remove('t1', 'admin', {})).rejects.toThrow(/in use/i);
    expect(prisma.reportingTemplate.update).not.toHaveBeenCalled();
  });

  it('soft-deletes an unused template', async () => {
    const { service, prisma } = buildService();
    prisma.reportingTemplate.findFirst.mockResolvedValue({
      id: 't1',
      name: 'T',
      _count: { periods: 0, submissions: 0 },
    });
    await service.remove('t1', 'admin', {});
    expect(prisma.reportingTemplate.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
    );
  });

  it('blocks editing a published template (immutability)', async () => {
    const { service, prisma } = buildService();
    prisma.reportingTemplate.findFirst.mockResolvedValue({
      id: 't1',
      status: TemplateStatus.PUBLISHED,
    });
    await expect(service.addSection('t1', section, 'admin', {})).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.templateSection.create).not.toHaveBeenCalled();
  });

  it('refuses to publish a template with no sections', async () => {
    const { service, prisma } = buildService();
    prisma.reportingTemplate.findFirst.mockResolvedValue({
      id: 't1',
      name: 'T',
      status: TemplateStatus.DRAFT,
      _count: { sections: 0 },
    });
    await expect(service.publish('t1', 'admin', {})).rejects.toThrow(BadRequestException);
  });
});
