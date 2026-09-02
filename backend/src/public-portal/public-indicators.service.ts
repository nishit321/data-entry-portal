import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, FieldType, Prisma, PublicAggregation, TemplateStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../common/utils/request-context.util';
import { CreatePublicIndicatorDto, UpdatePublicIndicatorDto } from './dto/public-indicator.dto';

const NUMERIC_TYPES: FieldType[] = [
  FieldType.INTEGER,
  FieldType.DECIMAL,
  FieldType.MONETARY,
  FieldType.PERCENTAGE,
];

const indicatorSelect = {
  id: true,
  fieldKey: true,
  aggregation: true,
  label: true,
  unit: true,
  description: true,
  order: true,
  isPublished: true,
  createdAt: true,
} satisfies Prisma.PublicIndicatorSelect;

/**
 * Managing what the public sees (Q4). Administrators only, and audited like any other decision
 * about what leaves the building.
 *
 * Two guards sit on the way in. A question must actually exist on a published questionnaire and be
 * numeric, because an allowlist entry that names nothing publishes nothing and nobody finds out
 * until a citizen asks why the page is blank. And a levy-basis field is refused outright: that is
 * the revenue figure Q4 names as commercially sensitive, and no amount of aggregation makes
 * publishing it the right call without a separate decision.
 */
@Injectable()
export class PublicIndicatorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.publicIndicator.findMany({
      where: { deletedAt: null },
      orderBy: [{ order: 'asc' }, { label: 'asc' }],
      select: indicatorSelect,
    });
  }

  /** The questions that could be published: numeric, on a published questionnaire, not levy basis. */
  async available() {
    const fields = await this.prisma.templateField.findMany({
      where: {
        dataType: { in: NUMERIC_TYPES },
        isLevyBasis: false,
        section: { template: { deletedAt: null, status: TemplateStatus.PUBLISHED } },
      },
      select: {
        key: true,
        label: true,
        unit: true,
        section: { select: { title: true, template: { select: { name: true } } } },
      },
      orderBy: [{ section: { order: 'asc' } }, { order: 'asc' }],
    });

    const seen = new Map<string, (typeof fields)[number]>();
    for (const field of fields) if (!seen.has(field.key)) seen.set(field.key, field);

    return {
      fields: [...seen.values()].map((f) => ({
        fieldKey: f.key,
        label: f.label,
        unit: f.unit,
        section: f.section.title,
        template: f.section.template.name,
      })),
    };
  }

  async create(dto: CreatePublicIndicatorDto, actorId: string, ctx: RequestContext) {
    await this.assertPublishable(dto.fieldKey);
    const aggregation = dto.aggregation ?? PublicAggregation.SUM;

    const clash = await this.prisma.publicIndicator.findFirst({
      where: { fieldKey: dto.fieldKey, aggregation, deletedAt: null },
      select: { id: true },
    });
    if (clash) {
      throw new BadRequestException('That question is already on the list with this calculation.');
    }

    const indicator = await this.prisma.publicIndicator.upsert({
      // The unique index covers soft-deleted rows too, so re-adding a question that was previously
      // removed revives that row rather than colliding with it.
      where: { fieldKey_aggregation: { fieldKey: dto.fieldKey, aggregation } },
      create: {
        fieldKey: dto.fieldKey,
        aggregation,
        label: dto.label.trim(),
        unit: dto.unit?.trim() || null,
        description: dto.description?.trim() || null,
        order: dto.order ?? 0,
        isPublished: dto.isPublished ?? false,
        createdById: actorId,
      },
      update: {
        label: dto.label.trim(),
        unit: dto.unit?.trim() || null,
        description: dto.description?.trim() || null,
        order: dto.order ?? 0,
        isPublished: dto.isPublished ?? false,
        deletedAt: null,
        createdById: actorId,
      },
      select: indicatorSelect,
    });

    await this.record(AuditAction.PUBLIC_INDICATOR_CREATED, indicator.id, actorId, ctx, {
      fieldKey: dto.fieldKey,
      aggregation,
      isPublished: indicator.isPublished,
    });
    return indicator;
  }

  async update(id: string, dto: UpdatePublicIndicatorDto, actorId: string, ctx: RequestContext) {
    const existing = await this.prisma.publicIndicator.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('That published figure is not on the list.');

    const indicator = await this.prisma.publicIndicator.update({
      where: { id },
      data: {
        aggregation: dto.aggregation,
        label: dto.label?.trim(),
        unit: dto.unit === undefined ? undefined : dto.unit.trim() || null,
        description: dto.description === undefined ? undefined : dto.description.trim() || null,
        order: dto.order,
        isPublished: dto.isPublished,
      },
      select: indicatorSelect,
    });
    await this.record(AuditAction.PUBLIC_INDICATOR_UPDATED, id, actorId, ctx, {
      changes: { ...dto },
    });
    return indicator;
  }

  /** Take a figure off the public site. Soft-deleted, so the decision trail survives. */
  async remove(id: string, actorId: string, ctx: RequestContext) {
    const existing = await this.prisma.publicIndicator.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('That published figure is not on the list.');
    await this.prisma.publicIndicator.update({
      where: { id },
      data: { deletedAt: new Date(), isPublished: false },
    });
    await this.record(AuditAction.PUBLIC_INDICATOR_DELETED, id, actorId, ctx);
    return { message: 'Figure removed from the public site' };
  }

  private async assertPublishable(fieldKey: string) {
    const field = await this.prisma.templateField.findFirst({
      where: {
        key: fieldKey,
        section: { template: { deletedAt: null, status: TemplateStatus.PUBLISHED } },
      },
      select: { dataType: true, isLevyBasis: true },
    });
    if (!field) {
      throw new BadRequestException('That question is not on any published questionnaire.');
    }
    if (!NUMERIC_TYPES.includes(field.dataType)) {
      throw new BadRequestException('Only figures can be published, not text or dates.');
    }
    if (field.isLevyBasis) {
      throw new BadRequestException(
        'Revenue used to assess the levy is commercially sensitive and cannot be published.',
      );
    }
  }

  private record(
    action: AuditAction,
    indicatorId: string,
    actorId: string,
    ctx: RequestContext,
    metadata?: Record<string, unknown>,
  ) {
    return this.audit.record({
      action,
      actorId,
      entityType: 'PublicIndicator',
      entityId: indicatorId,
      metadata: metadata as Prisma.InputJsonValue,
      context: ctx,
    });
  }
}
