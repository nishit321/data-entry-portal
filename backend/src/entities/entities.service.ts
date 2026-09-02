import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, EntityStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../common/utils/request-context.util';
import { paginate, toSkipTake } from '../common/utils/pagination.util';
import { CreateEntityDto } from './dto/create-entity.dto';
import { UpdateEntityDto } from './dto/update-entity.dto';
import { EntityQueryDto } from './dto/entity-query.dto';
import { entityListSelect, publicEntitySelect } from './entities.constants';

@Injectable()
export class EntitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Paginated list for Authority users, with optional type/status/search filters. */
  async findAll(query: EntityQueryDto) {
    const where: Prisma.EntityWhereInput = {
      deletedAt: null,
      type: query.type,
      status: query.status,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { licenceNumber: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const orderBy = { [query.sort]: query.order } as Prisma.EntityOrderByWithRelationInput;
    const { skip, take } = toSkipTake(query);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.entity.findMany({
        where,
        select: entityListSelect,
        orderBy,
        skip,
        take,
      }),
      this.prisma.entity.count({ where }),
    ]);

    return paginate(rows, total, query);
  }

  async findOne(id: string) {
    const entity = await this.prisma.entity.findFirst({
      where: { id, deletedAt: null },
      select: publicEntitySelect,
    });
    if (!entity) throw new NotFoundException('Entity not found');
    return entity;
  }

  /** The calling operator's own entity. */
  async findMine(entityId: string | null) {
    if (!entityId) {
      throw new ForbiddenException('Your account is not linked to an entity');
    }
    return this.findOne(entityId);
  }

  async create(dto: CreateEntityDto, actorId: string, ctx: RequestContext) {
    const entity = await this.prisma.entity.create({
      data: {
        name: dto.name.trim(),
        type: dto.type,
        status: dto.status ?? EntityStatus.PENDING,
        licenceNumber: dto.licenceNumber.trim(),
        licenceIssuedAt: dto.licenceIssuedAt ? new Date(dto.licenceIssuedAt) : null,
        yearsInOperation: dto.yearsInOperation,
        geographicScope: dto.geographicScope?.trim(),
        headquartersAddress: dto.headquartersAddress?.trim(),
        primaryContactName: dto.primaryContactName?.trim(),
        primaryContactTitle: dto.primaryContactTitle?.trim(),
        primaryContactEmail: dto.primaryContactEmail?.toLowerCase(),
        primaryContactPhone: dto.primaryContactPhone?.trim(),
      },
      select: publicEntitySelect,
    });

    await this.audit.record({
      action: AuditAction.ENTITY_CREATED,
      actorId,
      entityType: 'Entity',
      entityId: entity.id,
      metadata: { name: entity.name, type: entity.type },
      context: ctx,
    });
    return entity;
  }

  async update(id: string, dto: UpdateEntityDto, actorId: string, ctx: RequestContext) {
    const before = await this.findOne(id); // 404 if missing/deleted
    const licenceChanged =
      dto.licenceNumber !== undefined && dto.licenceNumber.trim() !== before.licenceNumber;

    const entity = await this.prisma.entity.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        type: dto.type,
        licenceNumber: dto.licenceNumber?.trim(),
        licenceIssuedAt: dto.licenceIssuedAt ? new Date(dto.licenceIssuedAt) : undefined,
        yearsInOperation: dto.yearsInOperation,
        geographicScope: dto.geographicScope?.trim(),
        headquartersAddress: dto.headquartersAddress?.trim(),
        primaryContactName: dto.primaryContactName?.trim(),
        primaryContactTitle: dto.primaryContactTitle?.trim(),
        primaryContactEmail: dto.primaryContactEmail?.toLowerCase(),
        primaryContactPhone: dto.primaryContactPhone?.trim(),
      },
      select: publicEntitySelect,
    });

    // A licence change is a material change (Q2): reset the entity's clean streaks so the next
    // return can't fast-track off history that predates it.
    if (licenceChanged) {
      await this.prisma.complianceStreak.updateMany({
        where: { entityId: id },
        data: { count: 0 },
      });
    }

    await this.audit.record({
      action: AuditAction.ENTITY_UPDATED,
      actorId,
      entityType: 'Entity',
      entityId: id,
      metadata: { changes: { ...dto } },
      context: ctx,
    });
    return entity;
  }

  async setStatus(id: string, status: EntityStatus, actorId: string, ctx: RequestContext) {
    const before = await this.findOne(id);
    const entity = await this.prisma.entity.update({
      where: { id },
      data: { status },
      select: publicEntitySelect,
    });

    await this.audit.record({
      action: AuditAction.ENTITY_STATUS_CHANGED,
      actorId,
      entityType: 'Entity',
      entityId: id,
      metadata: { from: before.status, to: status },
      context: ctx,
    });
    return entity;
  }

  /** Soft-delete: regulatory data is retained, never physically removed. */
  async remove(id: string, actorId: string, ctx: RequestContext) {
    const entity = await this.findOne(id);
    // Soft-delete the entity and, in the same transaction, deactivate its operator users so a
    // "deleted" entity's people can no longer sign in or transact.
    await this.prisma.$transaction([
      this.prisma.entity.update({ where: { id }, data: { deletedAt: new Date() } }),
      this.prisma.user.updateMany({
        where: { entityId: id, deletedAt: null, isActive: true },
        data: { isActive: false },
      }),
    ]);

    await this.audit.record({
      action: AuditAction.ENTITY_DELETED,
      actorId,
      entityType: 'Entity',
      entityId: id,
      metadata: { name: entity.name, licenceNumber: entity.licenceNumber },
      context: ctx,
    });
    return { message: 'Entity deleted' };
  }
}
