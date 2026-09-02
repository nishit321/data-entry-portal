import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma, ReferenceCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../common/utils/request-context.util';
import { paginate, toSkipTake } from '../common/utils/pagination.util';
import { CreateReferenceItemDto } from './dto/create-reference-item.dto';
import { UpdateReferenceItemDto } from './dto/update-reference-item.dto';
import { ReferenceQueryDto } from './dto/reference-query.dto';
import { publicReferenceSelect } from './reference-data.constants';

@Injectable()
export class ReferenceDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The available categories (structural — fixed at the schema level). */
  listCategories(): ReferenceCategory[] {
    return Object.values(ReferenceCategory);
  }

  /**
   * The active items of one category, ordered for display. Reference lists are
   * bounded by design, so this returns the full list (no pagination) — it is the
   * form-facing lookup consumed when rendering questionnaire controls.
   */
  lookup(category: ReferenceCategory) {
    return this.prisma.referenceItem.findMany({
      where: { category, isActive: true, deletedAt: null },
      select: publicReferenceSelect,
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });
  }

  /** Paginated management listing with optional category/status/search filters. */
  async findAll(query: ReferenceQueryDto) {
    const where: Prisma.ReferenceItemWhereInput = {
      deletedAt: null,
      category: query.category,
      isActive: query.isActive,
      ...(query.search
        ? {
            OR: [
              { label: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const orderBy = { [query.sort]: query.order } as Prisma.ReferenceItemOrderByWithRelationInput;
    const { skip, take } = toSkipTake(query);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.referenceItem.findMany({
        where,
        select: publicReferenceSelect,
        orderBy,
        skip,
        take,
      }),
      this.prisma.referenceItem.count({ where }),
    ]);
    return paginate(rows, total, query);
  }

  async findOne(id: string) {
    const item = await this.prisma.referenceItem.findFirst({
      where: { id, deletedAt: null },
      select: publicReferenceSelect,
    });
    if (!item) throw new NotFoundException('Reference item not found');
    return item;
  }

  async create(dto: CreateReferenceItemDto, actorId: string, ctx: RequestContext) {
    const code = dto.code.trim();

    // The (category, code) unique constraint spans soft-deleted rows. If a
    // matching row was previously removed, revive it instead of colliding.
    const existing = await this.prisma.referenceItem.findUnique({
      where: { category_code: { category: dto.category, code } },
    });
    if (existing && !existing.deletedAt) {
      throw new ConflictException(
        'A reference item with this code already exists in this category',
      );
    }

    const data = {
      label: dto.label.trim(),
      description: dto.description?.trim(),
      sortOrder: dto.sortOrder ?? 0,
      isActive: true,
    };

    const item = existing
      ? await this.prisma.referenceItem.update({
          where: { id: existing.id },
          data: { ...data, deletedAt: null },
          select: publicReferenceSelect,
        })
      : await this.prisma.referenceItem.create({
          data: { category: dto.category, code, ...data },
          select: publicReferenceSelect,
        });

    await this.audit.record({
      action: AuditAction.REFERENCE_ITEM_CREATED,
      actorId,
      entityType: 'ReferenceItem',
      entityId: item.id,
      metadata: { category: item.category, code: item.code, revived: !!existing },
      context: ctx,
    });
    return item;
  }

  async update(id: string, dto: UpdateReferenceItemDto, actorId: string, ctx: RequestContext) {
    await this.findOne(id);
    const item = await this.prisma.referenceItem.update({
      where: { id },
      data: {
        label: dto.label?.trim(),
        description: dto.description?.trim(),
        sortOrder: dto.sortOrder,
        isActive: dto.isActive,
      },
      select: publicReferenceSelect,
    });
    await this.audit.record({
      action: AuditAction.REFERENCE_ITEM_UPDATED,
      actorId,
      entityType: 'ReferenceItem',
      entityId: id,
      metadata: { changes: { ...dto } },
      context: ctx,
    });
    return item;
  }

  /** Soft-delete: the value is retained (and can be revived by re-creating it). */
  async remove(id: string, actorId: string, ctx: RequestContext) {
    const item = await this.findOne(id);
    await this.prisma.referenceItem.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      action: AuditAction.REFERENCE_ITEM_DELETED,
      actorId,
      entityType: 'ReferenceItem',
      entityId: id,
      metadata: { category: item.category, code: item.code },
      context: ctx,
    });
    return { message: 'Reference item deleted' };
  }
}
