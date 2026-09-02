import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, EntityStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../common/utils/request-context.util';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { paginate, toSkipTake } from '../common/utils/pagination.util';
import {
  assertCanAccessEntity,
  entityScopeFilter,
  resolveTargetEntityId,
} from '../common/utils/data-scope.util';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';
import { AgentQueryDto } from './dto/agent-query.dto';
import { publicAgentSelect } from './agents.constants';

@Injectable()
export class AgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Paginated list, always scoped by data segregation: an operator sees only its
   * own agents; Authority roles see all and may filter by entityId.
   */
  async findAll(user: AuthUser, query: AgentQueryDto) {
    const scopedEntityId = entityScopeFilter(user);
    const where: Prisma.AgentWhereInput = {
      deletedAt: null,
      // Operator: forced to own entity. Authority: undefined here, so honour the
      // optional entityId filter from the query instead.
      entityId: scopedEntityId ?? query.entityId,
      isActive: query.isActive,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { agentReference: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const orderBy = { [query.sort]: query.order } as Prisma.AgentOrderByWithRelationInput;
    const { skip, take } = toSkipTake(query);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.agent.findMany({
        where,
        select: publicAgentSelect,
        orderBy,
        skip,
        take,
      }),
      this.prisma.agent.count({ where }),
    ]);

    return paginate(rows, total, query);
  }

  async findOne(user: AuthUser, id: string) {
    const agent = await this.prisma.agent.findFirst({
      where: { id, deletedAt: null },
      select: publicAgentSelect,
    });
    if (!agent) throw new NotFoundException('Agent not found');
    assertCanAccessEntity(user, agent.entityId);
    return agent;
  }

  async create(user: AuthUser, dto: CreateAgentDto, ctx: RequestContext) {
    const entityId = resolveTargetEntityId(user, dto.entityId);

    // The owning entity must exist and be active: agents can only be added to an entity that is
    // currently allowed to operate, never to a pending, suspended, or deregistered one.
    const entity = await this.prisma.entity.findFirst({
      where: { id: entityId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!entity) {
      throw new BadRequestException("That entity doesn't exist.");
    }
    if (entity.status !== EntityStatus.ACTIVE) {
      throw new BadRequestException('Agents can only be added to an active entity.');
    }

    const agent = await this.prisma.agent.create({
      data: {
        entityId,
        agentReference: dto.agentReference.trim(),
        name: dto.name.trim(),
        location: dto.location?.trim(),
        latitude: dto.latitude,
        longitude: dto.longitude,
        isActive: dto.isActive ?? true,
      },
      select: publicAgentSelect,
    });

    await this.audit.record({
      action: AuditAction.AGENT_CREATED,
      actorId: user.id,
      entityType: 'Agent',
      entityId: agent.id,
      metadata: { entityId, agentReference: agent.agentReference },
      context: ctx,
    });
    return agent;
  }

  async update(user: AuthUser, id: string, dto: UpdateAgentDto, ctx: RequestContext) {
    const before = await this.findOne(user, id); // enforces scope + 404

    const agent = await this.prisma.agent.update({
      where: { id },
      data: {
        agentReference: dto.agentReference?.trim(),
        name: dto.name?.trim(),
        location: dto.location?.trim(),
        latitude: dto.latitude,
        longitude: dto.longitude,
        isActive: dto.isActive,
      },
      select: publicAgentSelect,
    });

    await this.audit.record({
      action: AuditAction.AGENT_UPDATED,
      actorId: user.id,
      entityType: 'Agent',
      entityId: id,
      metadata: { changes: { ...dto } },
      context: ctx,
    });

    if (dto.isActive !== undefined && dto.isActive !== before.isActive) {
      await this.audit.record({
        action: AuditAction.AGENT_STATUS_CHANGED,
        actorId: user.id,
        entityType: 'Agent',
        entityId: id,
        metadata: { from: before.isActive, to: dto.isActive },
        context: ctx,
      });
    }
    return agent;
  }

  /** Soft-delete: agent records are retained for history. */
  async remove(user: AuthUser, id: string, ctx: RequestContext) {
    const agent = await this.findOne(user, id); // enforces scope + 404
    await this.prisma.agent.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      action: AuditAction.AGENT_DELETED,
      actorId: user.id,
      entityType: 'Agent',
      entityId: id,
      metadata: { entityId: agent.entityId, agentReference: agent.agentReference },
      context: ctx,
    });
    return { message: 'Agent deleted' };
  }
}
