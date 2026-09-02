import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { EntityStatus, Role } from '@prisma/client';
import { AgentsService } from './agents.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { AgentQueryDto } from './dto/agent-query.dto';

const ENTITY_A = '11111111-1111-1111-1111-111111111111';
const ENTITY_B = '22222222-2222-2222-2222-222222222222';

function buildService() {
  const prisma = {
    agent: {
      findMany: jest.fn().mockReturnValue([]),
      count: jest.fn().mockReturnValue(0),
      findFirst: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'new-agent', entityId: ENTITY_A }),
      update: jest.fn(),
    },
    entity: {
      findFirst: jest.fn().mockResolvedValue({ id: ENTITY_A, status: EntityStatus.ACTIVE }),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new AgentsService(prisma as never, audit as never);
  return { service, prisma, audit };
}

const operator = (entityId: string | null): AuthUser => ({
  id: 'op-user',
  email: 'op@x.ss',
  role: Role.OPERATOR_ADMIN,
  entityId,
});
const admin: AuthUser = { id: 'adm', email: 'a@x.ss', role: Role.ADMIN, entityId: null };

const query = (over: Partial<AgentQueryDto> = {}): AgentQueryDto =>
  ({ page: 1, pageSize: 20, order: 'desc', sort: 'createdAt', ...over }) as AgentQueryDto;

describe('AgentsService — data segregation', () => {
  it('forces an operator to its own entity even if it passes another entityId', async () => {
    const { service, prisma } = buildService();
    await service.findAll(operator(ENTITY_A), query({ entityId: ENTITY_B }));
    expect(prisma.agent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ entityId: ENTITY_A }) }),
    );
  });

  it('lets Authority filter by the requested entityId', async () => {
    const { service, prisma } = buildService();
    await service.findAll(admin, query({ entityId: ENTITY_B }));
    expect(prisma.agent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ entityId: ENTITY_B }) }),
    );
  });

  it('applies no entity filter for Authority without a requested entityId', async () => {
    const { service, prisma } = buildService();
    await service.findAll(admin, query());
    const arg = prisma.agent.findMany.mock.calls[0][0];
    expect(arg.where.entityId).toBeUndefined();
  });

  it('blocks an operator from reading another entity’s agent', async () => {
    const { service, prisma } = buildService();
    prisma.agent.findFirst.mockResolvedValue({ id: 'a1', entityId: ENTITY_B });
    await expect(service.findOne(operator(ENTITY_A), 'a1')).rejects.toThrow(ForbiddenException);
  });

  it('lets an operator read its own agent', async () => {
    const { service, prisma } = buildService();
    prisma.agent.findFirst.mockResolvedValue({ id: 'a1', entityId: ENTITY_A });
    await expect(service.findOne(operator(ENTITY_A), 'a1')).resolves.toEqual({
      id: 'a1',
      entityId: ENTITY_A,
    });
  });

  it('forbids an operator creating an agent under another entity', async () => {
    const { service } = buildService();
    await expect(
      service.create(
        operator(ENTITY_A),
        { agentReference: 'AG', name: 'X', entityId: ENTITY_B },
        {},
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('creates an operator’s agent under its own entity', async () => {
    const { service, prisma } = buildService();
    await service.create(operator(ENTITY_A), { agentReference: 'AG', name: 'X' }, {});
    expect(prisma.agent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ entityId: ENTITY_A }) }),
    );
  });

  it('refuses to add an agent to a non-active entity', async () => {
    const { service, prisma } = buildService();
    prisma.entity.findFirst.mockResolvedValue({ id: ENTITY_A, status: EntityStatus.SUSPENDED });
    await expect(
      service.create(operator(ENTITY_A), { agentReference: 'AG', name: 'X' }, {}),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.agent.create).not.toHaveBeenCalled();
  });
});
