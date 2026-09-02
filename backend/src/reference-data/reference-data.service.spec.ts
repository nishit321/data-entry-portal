import { ConflictException } from '@nestjs/common';
import { ReferenceCategory } from '@prisma/client';
import { ReferenceDataService } from './reference-data.service';
import { CreateReferenceItemDto } from './dto/create-reference-item.dto';

function buildService() {
  const prisma = {
    referenceItem: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'new', category: 'TECHNOLOGY', code: 'LTE' }),
      update: jest.fn().mockResolvedValue({ id: 'rev', category: 'TECHNOLOGY', code: 'LTE' }),
    },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new ReferenceDataService(prisma as never, audit as never);
  return { service, prisma };
}

const dto: CreateReferenceItemDto = {
  category: ReferenceCategory.TECHNOLOGY,
  code: 'LTE',
  label: 'LTE',
};

describe('ReferenceDataService', () => {
  it('rejects a duplicate active code in the same category', async () => {
    const { service, prisma } = buildService();
    prisma.referenceItem.findUnique.mockResolvedValue({ id: 'x', deletedAt: null });
    await expect(service.create(dto, 'admin', {})).rejects.toThrow(ConflictException);
    expect(prisma.referenceItem.create).not.toHaveBeenCalled();
  });

  it('revives a soft-deleted item instead of creating a duplicate', async () => {
    const { service, prisma } = buildService();
    prisma.referenceItem.findUnique.mockResolvedValue({
      id: 'x',
      deletedAt: new Date('2026-01-01'),
    });
    await service.create(dto, 'admin', {});
    expect(prisma.referenceItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'x' },
        data: expect.objectContaining({ deletedAt: null }),
      }),
    );
    expect(prisma.referenceItem.create).not.toHaveBeenCalled();
  });

  it('creates a fresh item when none exists', async () => {
    const { service, prisma } = buildService();
    prisma.referenceItem.findUnique.mockResolvedValue(null);
    await service.create(dto, 'admin', {});
    expect(prisma.referenceItem.create).toHaveBeenCalled();
  });

  it('lookup returns only active, non-deleted items of the category, ordered', async () => {
    const { service, prisma } = buildService();
    await service.lookup(ReferenceCategory.SPECTRUM_BAND);
    expect(prisma.referenceItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { category: ReferenceCategory.SPECTRUM_BAND, isActive: true, deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
      }),
    );
  });
});
