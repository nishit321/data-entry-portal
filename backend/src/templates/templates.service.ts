import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, FieldType, Prisma, RuleSeverity, TemplateStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../common/utils/request-context.util';
import { paginate, toSkipTake } from '../common/utils/pagination.util';
import { CreateTemplateDto, TemplateQueryDto, UpdateTemplateDto } from './dto/template.dto';
import { CreateSectionDto, UpdateSectionDto } from './dto/section.dto';
import { CreateFieldDto, UpdateFieldDto } from './dto/field.dto';
import { CreateRuleDto, UpdateRuleDto } from './dto/rule.dto';
import { ruleReferencesKey, validateRuleConfig } from './rule-config';
import { templateDetailInclude, templateListSelect } from './templates.constants';

/** Field types a cross-field rule can operate on. */
const NUMERIC_FIELD_TYPES: FieldType[] = [
  FieldType.INTEGER,
  FieldType.DECIMAL,
  FieldType.MONETARY,
  FieldType.PERCENTAGE,
];

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(query: TemplateQueryDto) {
    const where: Prisma.ReportingTemplateWhereInput = {
      deletedAt: null,
      status: query.status,
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const orderBy = {
      [query.sort]: query.order,
    } as Prisma.ReportingTemplateOrderByWithRelationInput;
    const { skip, take } = toSkipTake(query);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.reportingTemplate.findMany({
        where,
        select: templateListSelect,
        orderBy,
        skip,
        take,
      }),
      this.prisma.reportingTemplate.count({ where }),
    ]);
    return paginate(rows, total, query);
  }

  /** Full template definition (ordered sections + fields). */
  async findOne(id: string) {
    const template = await this.prisma.reportingTemplate.findFirst({
      where: { id, deletedAt: null },
      include: templateDetailInclude,
    });
    if (!template) throw new NotFoundException('Template not found');
    return template;
  }

  /** Load a template that must be an editable DRAFT, or throw. */
  private async getDraft(id: string) {
    const template = await this.prisma.reportingTemplate.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!template) throw new NotFoundException('Template not found');
    if (template.status !== TemplateStatus.DRAFT) {
      throw new BadRequestException(
        'Only a draft template can be edited. Create a new version to change a published template.',
      );
    }
    return template;
  }

  async create(dto: CreateTemplateDto, actorId: string, ctx: RequestContext) {
    const template = await this.prisma.reportingTemplate.create({
      data: { name: dto.name.trim(), description: dto.description?.trim(), version: 1 },
      include: templateDetailInclude,
    });
    await this.record(AuditAction.TEMPLATE_CREATED, template.id, actorId, ctx, {
      name: template.name,
    });
    return template;
  }

  async update(id: string, dto: UpdateTemplateDto, actorId: string, ctx: RequestContext) {
    await this.getDraft(id);
    await this.prisma.reportingTemplate.update({
      where: { id },
      data: { name: dto.name?.trim(), description: dto.description?.trim() },
    });
    await this.record(AuditAction.TEMPLATE_UPDATED, id, actorId, ctx, { changes: { ...dto } });
    return this.findOne(id);
  }

  /** DRAFT → PUBLISHED; supersedes any other published version of the same name. */
  async publish(id: string, actorId: string, ctx: RequestContext) {
    const template = await this.prisma.reportingTemplate.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, status: true, _count: { select: { sections: true } } },
    });
    if (!template) throw new NotFoundException('Template not found');
    if (template.status !== TemplateStatus.DRAFT) {
      throw new BadRequestException('Only a draft template can be published');
    }
    if (template._count.sections === 0) {
      throw new BadRequestException('Add at least one section before publishing');
    }

    // Final integrity gate: every rule must still point at real numeric fields. This catches
    // drift — e.g. a field renamed via a new version, or config that predates these checks.
    const rules = await this.prisma.templateRule.findMany({
      where: { templateId: id },
      select: { label: true, type: true, config: true },
    });
    if (rules.length > 0) {
      const numericKeys = await this.numericFieldKeys(id);
      for (const rule of rules) {
        const problem = validateRuleConfig(
          rule.type,
          rule.config as Record<string, unknown>,
          numericKeys,
        );
        if (problem) {
          throw new BadRequestException(
            `The validation rule "${rule.label}" can't be used: ${problem} Fix it before publishing.`,
          );
        }
      }
    }

    await this.prisma.$transaction([
      // Archive the currently-published version(s) of the same name.
      this.prisma.reportingTemplate.updateMany({
        where: {
          name: template.name,
          status: TemplateStatus.PUBLISHED,
          deletedAt: null,
          id: { not: id },
        },
        data: { status: TemplateStatus.ARCHIVED },
      }),
      this.prisma.reportingTemplate.update({
        where: { id },
        data: { status: TemplateStatus.PUBLISHED, publishedAt: new Date() },
      }),
    ]);
    await this.record(AuditAction.TEMPLATE_PUBLISHED, id, actorId, ctx, { name: template.name });
    return this.findOne(id);
  }

  /** Clone a template into a fresh DRAFT with the next version number. */
  async newVersion(id: string, actorId: string, ctx: RequestContext) {
    const source = await this.findOne(id);
    const latest = await this.prisma.reportingTemplate.aggregate({
      where: { name: source.name },
      _max: { version: true },
    });
    const nextVersion = (latest._max.version ?? source.version) + 1;

    const clone = await this.prisma.reportingTemplate.create({
      data: {
        name: source.name,
        description: source.description,
        version: nextVersion,
        status: TemplateStatus.DRAFT,
        sections: {
          create: source.sections.map((s) => ({
            key: s.key,
            title: s.title,
            description: s.description,
            order: s.order,
            applicableEntityTypes: s.applicableEntityTypes,
            frequency: s.frequency,
            requiredServiceCode: s.requiredServiceCode,
            fields: {
              create: s.fields.map((f) => ({
                key: f.key,
                label: f.label,
                description: f.description,
                order: f.order,
                dataType: f.dataType,
                unit: f.unit,
                decimals: f.decimals,
                isMandatory: f.isMandatory,
                flowOrStock: f.flowOrStock,
                minValue: f.minValue,
                maxValue: f.maxValue,
                referenceCategory: f.referenceCategory,
                allowsOther: f.allowsOther,
                frequencyOverride: f.frequencyOverride,
                isLevyBasis: f.isLevyBasis,
              })),
            },
          })),
        },
        rules: {
          create: source.rules.map((r) => ({
            type: r.type,
            severity: r.severity,
            label: r.label,
            config: r.config as Prisma.InputJsonValue,
            order: r.order,
          })),
        },
      },
      include: templateDetailInclude,
    });
    await this.record(AuditAction.TEMPLATE_VERSIONED, clone.id, actorId, ctx, {
      from: id,
      version: nextVersion,
    });
    return clone;
  }

  /** Soft-delete: templates are retained for audit/history. */
  async remove(id: string, actorId: string, ctx: RequestContext) {
    const template = await this.prisma.reportingTemplate.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            periods: { where: { deletedAt: null } },
            submissions: { where: { deletedAt: null } },
          },
        },
      },
    });
    if (!template) throw new NotFoundException('Template not found');
    // A template that reporting periods or submissions still point at can't be removed — deleting
    // it would leave those records referencing a template that's meant to be gone.
    if (template._count.periods > 0 || template._count.submissions > 0) {
      throw new BadRequestException(
        'This template is in use by reporting periods or submissions, so it cannot be deleted.',
      );
    }
    await this.prisma.reportingTemplate.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.record(AuditAction.TEMPLATE_DELETED, id, actorId, ctx, { name: template.name });
    return { message: 'Template deleted' };
  }

  // --- Sections (draft only) ---------------------------------------------------

  async addSection(
    templateId: string,
    dto: CreateSectionDto,
    actorId: string,
    ctx: RequestContext,
  ) {
    await this.getDraft(templateId);
    const section = await this.prisma.templateSection.create({
      data: {
        templateId,
        key: dto.key.trim(),
        title: dto.title.trim(),
        description: dto.description?.trim(),
        order: dto.order ?? 0,
        applicableEntityTypes: dto.applicableEntityTypes,
        frequency: dto.frequency,
        requiredServiceCode: dto.requiredServiceCode?.trim(),
      },
    });
    await this.record(AuditAction.TEMPLATE_SECTION_SAVED, templateId, actorId, ctx, {
      sectionId: section.id,
      key: section.key,
    });
    return this.findOne(templateId);
  }

  async updateSection(
    templateId: string,
    sectionId: string,
    dto: UpdateSectionDto,
    actorId: string,
    ctx: RequestContext,
  ) {
    await this.getDraft(templateId);
    await this.getSection(templateId, sectionId);
    await this.prisma.templateSection.update({
      where: { id: sectionId },
      data: {
        title: dto.title?.trim(),
        description: dto.description?.trim(),
        order: dto.order,
        applicableEntityTypes: dto.applicableEntityTypes,
        frequency: dto.frequency,
        requiredServiceCode: dto.requiredServiceCode?.trim(),
      },
    });
    await this.record(AuditAction.TEMPLATE_SECTION_SAVED, templateId, actorId, ctx, { sectionId });
    return this.findOne(templateId);
  }

  async removeSection(templateId: string, sectionId: string, actorId: string, ctx: RequestContext) {
    await this.getDraft(templateId);
    await this.getSection(templateId, sectionId);
    await this.prisma.templateSection.delete({ where: { id: sectionId } });
    await this.record(AuditAction.TEMPLATE_SECTION_DELETED, templateId, actorId, ctx, {
      sectionId,
    });
    return this.findOne(templateId);
  }

  // --- Fields (draft only) -----------------------------------------------------

  async addField(
    templateId: string,
    sectionId: string,
    dto: CreateFieldDto,
    actorId: string,
    ctx: RequestContext,
  ) {
    await this.getDraft(templateId);
    await this.getSection(templateId, sectionId);
    const key = dto.key.trim();
    // Field keys must be unique across the whole template, not just the section: the validation
    // engine and submission values are keyed by field key, so a duplicate would let a cross-field
    // rule read the wrong field. (The DB only enforces per-section uniqueness.)
    const clash = await this.prisma.templateField.findFirst({
      where: { key, section: { templateId } },
      select: { id: true },
    });
    if (clash) {
      throw new BadRequestException(
        `Another field already uses the key "${key}" in this template.`,
      );
    }
    const field = await this.prisma.templateField.create({
      data: {
        sectionId,
        ...this.fieldData(dto),
        key,
        label: dto.label.trim(),
        dataType: dto.dataType,
      },
    });
    await this.record(AuditAction.TEMPLATE_FIELD_SAVED, templateId, actorId, ctx, {
      sectionId,
      fieldId: field.id,
      key: field.key,
    });
    return this.findOne(templateId);
  }

  async updateField(
    templateId: string,
    sectionId: string,
    fieldId: string,
    dto: UpdateFieldDto,
    actorId: string,
    ctx: RequestContext,
  ) {
    await this.getDraft(templateId);
    await this.getSection(templateId, sectionId);
    const existing = await this.prisma.templateField.findFirst({
      where: { id: fieldId, sectionId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Field not found');
    await this.prisma.templateField.update({
      where: { id: fieldId },
      data: { ...this.fieldData(dto), label: dto.label?.trim() },
    });
    await this.record(AuditAction.TEMPLATE_FIELD_SAVED, templateId, actorId, ctx, {
      sectionId,
      fieldId,
    });
    return this.findOne(templateId);
  }

  async removeField(
    templateId: string,
    sectionId: string,
    fieldId: string,
    actorId: string,
    ctx: RequestContext,
  ) {
    await this.getDraft(templateId);
    await this.getSection(templateId, sectionId);
    const existing = await this.prisma.templateField.findFirst({
      where: { id: fieldId, sectionId },
      select: { id: true, key: true },
    });
    if (!existing) throw new NotFoundException('Field not found');

    // Don't let a field vanish out from under a rule that depends on it — that would leave the
    // rule silently broken. Name the rules so the admin can fix them first.
    const rules = await this.prisma.templateRule.findMany({
      where: { templateId },
      select: { label: true, type: true, config: true },
    });
    const dependent = rules
      .filter((r) => ruleReferencesKey(r.type, r.config as Record<string, unknown>, existing.key))
      .map((r) => r.label);
    if (dependent.length > 0) {
      throw new BadRequestException(
        `This field is used by these validation rules: ${dependent.join(', ')}. Update or remove them before deleting the field.`,
      );
    }

    await this.prisma.templateField.delete({ where: { id: fieldId } });
    await this.record(AuditAction.TEMPLATE_FIELD_DELETED, templateId, actorId, ctx, {
      sectionId,
      fieldId,
    });
    return this.findOne(templateId);
  }

  // --- Cross-field rules (draft only) ------------------------------------------

  async addRule(templateId: string, dto: CreateRuleDto, actorId: string, ctx: RequestContext) {
    await this.getDraft(templateId);
    // A rule may only reference numeric fields that actually exist on the template — otherwise it
    // would silently never fire. This is the authoritative guard behind the editor's dropdowns.
    const numericKeys = await this.numericFieldKeys(templateId);
    const problem = validateRuleConfig(dto.type, dto.config, numericKeys);
    if (problem) throw new BadRequestException(problem);

    await this.prisma.templateRule.create({
      data: {
        templateId,
        type: dto.type,
        severity: dto.severity ?? RuleSeverity.HARD,
        label: dto.label.trim(),
        config: dto.config as Prisma.InputJsonValue,
        order: dto.order ?? 0,
      },
    });
    await this.record(AuditAction.TEMPLATE_RULE_SAVED, templateId, actorId, ctx, {
      type: dto.type,
    });
    return this.findOne(templateId);
  }

  async updateRule(
    templateId: string,
    ruleId: string,
    dto: UpdateRuleDto,
    actorId: string,
    ctx: RequestContext,
  ) {
    await this.getDraft(templateId);
    const existing = await this.getRule(templateId, ruleId);
    // Re-validate against the type (immutable on edit) and whichever config will be stored.
    const nextConfig = (dto.config ?? (existing.config as Record<string, unknown>)) as Record<
      string,
      unknown
    >;
    const numericKeys = await this.numericFieldKeys(templateId);
    const problem = validateRuleConfig(existing.type, nextConfig, numericKeys);
    if (problem) throw new BadRequestException(problem);

    await this.prisma.templateRule.update({
      where: { id: ruleId },
      data: {
        severity: dto.severity,
        label: dto.label?.trim(),
        config: dto.config as Prisma.InputJsonValue | undefined,
        order: dto.order,
      },
    });
    await this.record(AuditAction.TEMPLATE_RULE_SAVED, templateId, actorId, ctx, { ruleId });
    return this.findOne(templateId);
  }

  async removeRule(templateId: string, ruleId: string, actorId: string, ctx: RequestContext) {
    await this.getDraft(templateId);
    await this.getRule(templateId, ruleId);
    await this.prisma.templateRule.delete({ where: { id: ruleId } });
    await this.record(AuditAction.TEMPLATE_RULE_DELETED, templateId, actorId, ctx, { ruleId });
    return this.findOne(templateId);
  }

  // --- helpers -----------------------------------------------------------------

  private async getRule(templateId: string, ruleId: string) {
    const rule = await this.prisma.templateRule.findFirst({
      where: { id: ruleId, templateId },
      select: { id: true, type: true, config: true },
    });
    if (!rule) throw new NotFoundException('Rule not found');
    return rule;
  }

  /** The set of field keys on a template that a cross-field rule may reference (numeric only). */
  private async numericFieldKeys(templateId: string): Promise<Set<string>> {
    const fields = await this.prisma.templateField.findMany({
      where: { section: { templateId }, dataType: { in: NUMERIC_FIELD_TYPES } },
      select: { key: true },
    });
    return new Set(fields.map((f) => f.key));
  }

  private async getSection(templateId: string, sectionId: string) {
    const section = await this.prisma.templateSection.findFirst({
      where: { id: sectionId, templateId },
      select: { id: true },
    });
    if (!section) throw new NotFoundException('Section not found');
    return section;
  }

  /** Map a create/update field DTO to persisted columns (label/key set separately). */
  private fieldData(dto: CreateFieldDto | UpdateFieldDto) {
    return {
      description: dto.description?.trim(),
      order: dto.order,
      dataType: dto.dataType,
      unit: dto.unit?.trim(),
      decimals: dto.decimals,
      isMandatory: dto.isMandatory,
      flowOrStock: dto.flowOrStock,
      minValue: dto.minValue,
      maxValue: dto.maxValue,
      referenceCategory: dto.referenceCategory,
      allowsOther: dto.allowsOther,
      frequencyOverride: dto.frequencyOverride,
      isLevyBasis: dto.isLevyBasis,
    };
  }

  private record(
    action: AuditAction,
    templateId: string,
    actorId: string,
    ctx: RequestContext,
    metadata?: Prisma.InputJsonValue,
  ) {
    return this.audit.record({
      action,
      actorId,
      entityType: 'ReportingTemplate',
      entityId: templateId,
      metadata,
      context: ctx,
    });
  }
}
