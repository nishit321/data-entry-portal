import { NotFoundException } from '@nestjs/common';
import { AuditAction, EntityStatus, EntityType } from '@prisma/client';
import { EntitiesService } from './entities.service';
import { EntityQueryDto } from './dto/entity-query.dto';
import { CreateEntityDto } from './dto/create-entity.dto';

function buildService() {
  const prisma = {
    entity: {
      findMany: jest.fn().mockReturnValue([]),
      count: jest.fn().mockReturnValue(0),
      findFirst: jest.fn(),
      create: jest
        .fn()
        .mockResolvedValue({ id: 'e1', name: 'Nile', type: 'ISP', status: 'PENDING' }),
      update: jest.fn().mockResolvedValue({ id: 'e1', status: 'ACTIVE' }),
    },
    user: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new EntitiesService(prisma as never, audit as never);
  return { service, prisma, audit };
}

const query = (over: Partial<EntityQueryDto> = {}): EntityQueryDto =>
  ({ page: 1, pageSize: 20, order: 'desc', sort: 'createdAt', ...over }) as EntityQueryDto;

describe('EntitiesService', () => {
  it('excludes soft-deleted rows and applies filters in findAll', async () => {
    const { service, prisma } = buildService();
    await service.findAll(
      query({ type: EntityType.MNO, status: EntityStatus.ACTIVE, search: 'nile' }),
    );
    const arg = prisma.entity.findMany.mock.calls[0][0];
    expect(arg.where.deletedAt).toBeNull();
    expect(arg.where.type).toBe(EntityType.MNO);
    expect(arg.where.status).toBe(EntityStatus.ACTIVE);
    expect(arg.where.OR).toBeDefined();
  });

  it('defaults status to PENDING on create and audits it', async () => {
    const { service, prisma, audit } = buildService();
    const dto = {
      name: 'Nile ISP',
      type: EntityType.ISP,
      licenceNumber: 'NCA/ISP/9',
    } as CreateEntityDto;
    await service.create(dto, 'admin', {});
    expect(prisma.entity.create.mock.calls[0][0].data.status).toBe(EntityStatus.PENDING);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.ENTITY_CREATED }),
    );
  });

  it('soft-deletes (sets deletedAt), never hard-deletes', async () => {
    const { service, prisma, audit } = buildService();
    prisma.entity.findFirst.mockResolvedValue({ id: 'e1', name: 'Nile', licenceNumber: 'X' });
    await service.remove('e1', 'admin', {});
    expect(prisma.entity.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'e1' }, data: { deletedAt: expect.any(Date) } }),
    );
    // Deleting an entity also deactivates its users so they can no longer sign in.
    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ entityId: 'e1' }),
        data: { isActive: false },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.ENTITY_DELETED }),
    );
  });

  it('records the status transition on setStatus', async () => {
    const { service, prisma, audit } = buildService();
    prisma.entity.findFirst.mockResolvedValue({ id: 'e1', status: EntityStatus.PENDING });
    await service.setStatus('e1', EntityStatus.ACTIVE, 'admin', {});
    expect(prisma.entity.update.mock.calls[0][0].data.status).toBe(EntityStatus.ACTIVE);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.ENTITY_STATUS_CHANGED,
        metadata: { from: EntityStatus.PENDING, to: EntityStatus.ACTIVE },
      }),
    );
  });

  it('throws NotFound for a missing entity', async () => {
    const { service, prisma } = buildService();
    prisma.entity.findFirst.mockResolvedValue(null);
    await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
  });
});
