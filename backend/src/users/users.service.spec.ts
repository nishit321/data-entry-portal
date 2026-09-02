import { BadRequestException } from '@nestjs/common';
import { AuditAction, Role } from '@prisma/client';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/user.dto';

function buildService() {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'u1', email: 'x@x.ss', role: Role.ADMIN }),
      update: jest.fn().mockResolvedValue({ id: 'u1' }),
      count: jest.fn(),
    },
    entity: { findFirst: jest.fn() },
  };
  const mail = { sendWelcome: jest.fn().mockResolvedValue(undefined) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new UsersService(prisma as never, mail as never, audit as never);
  return { service, prisma, mail, audit };
}

const ctx = {};

describe('UsersService', () => {
  describe('role ↔ entity consistency (create)', () => {
    it('rejects an operator role with no entity', async () => {
      const { service, prisma } = buildService();
      const dto = {
        email: 'op@x.ss',
        firstName: 'O',
        lastName: 'P',
        role: Role.OPERATOR_ADMIN,
      } as CreateUserDto;
      await expect(service.create(dto, 'admin', ctx)).rejects.toThrow(BadRequestException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('rejects an entity on a non-operator role', async () => {
      const { service, prisma } = buildService();
      const dto = {
        email: 'a@x.ss',
        firstName: 'A',
        lastName: 'D',
        role: Role.ADMIN,
        entityId: '11111111-1111-1111-1111-111111111111',
      } as CreateUserDto;
      await expect(service.create(dto, 'admin', ctx)).rejects.toThrow(BadRequestException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('creates an Authority user and audits it', async () => {
      const { service, prisma, audit } = buildService();
      const dto = {
        email: 'a@x.ss',
        firstName: 'A',
        lastName: 'D',
        role: Role.ADMIN,
      } as CreateUserDto;
      await service.create(dto, 'admin', ctx);
      expect(prisma.user.create).toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.USER_CREATED }),
      );
    });
  });

  describe('last-admin protection (update / setRole)', () => {
    it('blocks demoting the last active admin via update', async () => {
      const { service, prisma } = buildService();
      prisma.user.findFirst.mockResolvedValue({
        id: 'u1',
        role: Role.ADMIN,
        isActive: true,
        entityId: null,
      });
      prisma.user.count.mockResolvedValue(0); // no other active admins
      await expect(service.update('u1', { role: Role.ANALYST }, 'admin', ctx)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('blocks deactivating the last active admin via update', async () => {
      const { service, prisma } = buildService();
      prisma.user.findFirst.mockResolvedValue({
        id: 'u1',
        role: Role.ADMIN,
        isActive: true,
        entityId: null,
      });
      prisma.user.count.mockResolvedValue(0);
      await expect(service.update('u1', { isActive: false }, 'admin', ctx)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('allows demoting an admin when another active admin remains', async () => {
      const { service, prisma } = buildService();
      prisma.user.findFirst.mockResolvedValue({
        id: 'u1',
        role: Role.ADMIN,
        isActive: true,
        entityId: null,
      });
      prisma.user.count.mockResolvedValue(1); // another active admin exists
      await service.update('u1', { role: Role.ANALYST }, 'admin', ctx);
      expect(prisma.user.update).toHaveBeenCalled();
    });

    it('blocks demoting the last active admin via setRole', async () => {
      const { service, prisma } = buildService();
      prisma.user.findFirst.mockResolvedValue({
        id: 'u1',
        role: Role.ADMIN,
        isActive: true,
        entityId: null,
      });
      prisma.user.count.mockResolvedValue(0);
      await expect(service.setRole('u1', Role.ANALYST, 'admin', ctx)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('blocks deleting your own account', async () => {
      const { service } = buildService();
      await expect(service.remove('me', 'me', ctx)).rejects.toThrow(BadRequestException);
    });

    it('blocks deleting the last admin', async () => {
      const { service, prisma } = buildService();
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', role: Role.ADMIN, email: 'a@x.ss' });
      prisma.user.count.mockResolvedValue(1);
      await expect(service.remove('u1', 'admin', ctx)).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('soft-deletes (sets deletedAt), never hard-deletes', async () => {
      const { service, prisma, audit } = buildService();
      prisma.user.findFirst.mockResolvedValue({
        id: 'u1',
        role: Role.OPERATOR_SUBMITTER,
        email: 'op@x.ss',
      });
      await service.remove('u1', 'admin', ctx);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1' },
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.USER_DELETED }),
      );
    });
  });
});
