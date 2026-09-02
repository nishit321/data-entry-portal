import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AttachmentKind,
  AuditAction,
  EntityStatus,
  EntityType,
  PeriodStatus,
  Prisma,
  ReviewStage,
  SubmissionStatus,
  TemplateStatus,
  SignatureFormat,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SignaturesService } from '../signatures/signatures.service';
import {
  VERIFICATION_MESSAGES,
  verifySubmissionSignature,
  type SignatureAlgorithm,
} from '../signatures/submission-digest';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../files/storage.service';
import { RequestContext } from '../common/utils/request-context.util';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { paginate, toSkipTake } from '../common/utils/pagination.util';
import {
  assertCanAccessEntity,
  entityScopeFilter,
  isOperatorRole,
} from '../common/utils/data-scope.util';
import { formatReferenceNumber } from '../common/utils/reference-number.util';
import { SubmittedValue, ValidationResult, ValidationSection } from './submission-validation';
import { RuleInput, runValidation } from './validation-engine';
import { CreateDraftDto, SaveValuesDto, SubmissionQueryDto, SubmitDto } from './dto/submission.dto';
import { submissionDetailSelect, submissionListSelect } from './submissions.constants';
import { SERVICE_CATEGORY, declaredServices, normaliseServiceCode } from './service-applicability';

@Injectable()
export class SubmissionsService {
  private readonly logger = new Logger(SubmissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly signatures: SignaturesService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Reclaim a draft the operator deleted earlier for this (entity, period).
   *
   * Deletion is soft, so the old row still holds its slot in
   * `@@unique([entityId, periodId, version])`. `startablePeriods` ignores deleted rows and offers
   * the period again, so without this the operator would hit that constraint on every attempt and
   * be locked out of filing for that period permanently. Reviving reuses the row, which also keeps
   * the audit trail for the period continuous. Answers are cleared, because the operator asked for
   * that draft to go away.
   *
   * Returns the revived submission id, or null when there is nothing to reclaim.
   */
  private async reviveDeletedDraft(
    entityId: string,
    periodId: string,
    userId: string,
  ): Promise<string | null> {
    const deleted = await this.prisma.submission.findFirst({
      where: {
        entityId,
        periodId,
        deletedAt: { not: null },
        status: SubmissionStatus.DRAFT,
        // Only a first-version draft occupies the slot a fresh start would want.
        version: 1,
      },
      orderBy: { deletedAt: 'desc' },
      select: { id: true },
    });
    if (!deleted) return null;

    await this.prisma.$transaction([
      this.prisma.submissionValue.deleteMany({ where: { submissionId: deleted.id } }),
      this.prisma.submissionAttachment.deleteMany({ where: { submissionId: deleted.id } }),
      this.prisma.submission.update({
        where: { id: deleted.id },
        data: { deletedAt: null, createdById: userId },
      }),
    ]);
    return deleted.id;
  }

  /** The caller's own entity id, or Forbidden if they aren't a linked operator. */
  private requireOperatorEntity(user: AuthUser): string {
    if (!isOperatorRole(user.role) || !user.entityId) {
      throw new ForbiddenException('Only operator users can act on returns');
    }
    return user.entityId;
  }

  /**
   * An entity may only work on returns — start a draft, edit values, or submit — while it is
   * ACTIVE. A pending, suspended, or deregistered entity is barred until the Authority changes
   * its status. Loads the status once and throws if it isn't active.
   */
  private async assertEntityActive(entityId: string): Promise<{ type: EntityType }> {
    const entity = await this.prisma.entity.findFirst({
      where: { id: entityId, deletedAt: null },
      select: { status: true, type: true },
    });
    if (!entity || entity.status !== EntityStatus.ACTIVE) {
      throw new ForbiddenException(
        "Your entity isn't active, so you can't work on returns right now. Contact the Authority.",
      );
    }
    return { type: entity.type };
  }

  /**
   * The reporting periods an operator can actually start work on: open periods whose published
   * template covers their entity type, and for which they have no return yet (draft or submitted).
   * This is what the "Start a return" picker offers — genuinely new work, not periods already
   * begun (resume those from the list) or finished. Scales cleanly: the filter runs in the DB.
   */
  async startablePeriods(user: AuthUser) {
    const entityId = this.requireOperatorEntity(user);
    const entity = await this.prisma.entity.findFirst({
      where: { id: entityId, deletedAt: null },
      select: { type: true, status: true },
    });
    if (!entity) throw new ForbiddenException('Only operator users can start a return');
    // A non-active entity can't start anything, so it has nothing startable.
    if (entity.status !== EntityStatus.ACTIVE) return [];

    return this.prisma.reportingPeriod.findMany({
      where: {
        deletedAt: null,
        status: PeriodStatus.OPEN,
        template: {
          deletedAt: null,
          status: TemplateStatus.PUBLISHED,
          // The template must have at least one section that applies to this operator's type,
          // otherwise the form would render empty for them.
          sections: { some: { applicableEntityTypes: { has: entity.type } } },
        },
        // Nothing started yet for this entity — a draft or submitted return removes the period.
        submissions: { none: { entityId, deletedAt: null } },
      },
      select: {
        id: true,
        label: true,
        frequency: true,
        dueDate: true,
        template: { select: { id: true, name: true, version: true } },
      },
      orderBy: { dueDate: 'asc' },
    });
  }

  async findAll(user: AuthUser, query: SubmissionQueryDto) {
    const scoped = entityScopeFilter(user); // operator → own id; authority → undefined
    // Inclusive submitted-date range: from start-of-day to end-of-day.
    const submittedAt =
      query.submittedFrom || query.submittedTo
        ? {
            ...(query.submittedFrom
              ? { gte: new Date(`${query.submittedFrom}T00:00:00.000Z`) }
              : {}),
            ...(query.submittedTo ? { lte: new Date(`${query.submittedTo}T23:59:59.999Z`) } : {}),
          }
        : undefined;
    const where: Prisma.SubmissionWhereInput = {
      deletedAt: null,
      // Show only the current version of each return — once a rejected return is revised, the old
      // version is superseded and drops out of the active list (it stays in the audit/history).
      supersededBy: null,
      entityId: scoped ?? query.entityId,
      status: query.status,
      periodId: query.periodId,
      templateId: query.templateId,
      isLate: query.isLate === undefined ? undefined : query.isLate === 'true',
      ...(submittedAt ? { submittedAt } : {}),
      ...(query.search ? { referenceNumber: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const orderBy = { [query.sort]: query.order } as Prisma.SubmissionOrderByWithRelationInput;
    const { skip, take } = toSkipTake(query);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.submission.findMany({ where, select: submissionListSelect, orderBy, skip, take }),
      this.prisma.submission.count({ where }),
    ]);
    return paginate(rows, total, query);
  }

  async findOne(user: AuthUser, id: string) {
    const submission = await this.prisma.submission.findFirst({
      where: { id, deletedAt: null },
      select: submissionDetailSelect,
    });
    if (!submission) throw new NotFoundException('Return not found');
    assertCanAccessEntity(user, submission.entityId);
    return submission;
  }

  /** Operator opens (or resumes) their draft for a period. */
  async getOrCreateDraft(user: AuthUser, dto: CreateDraftDto, ctx: RequestContext) {
    const entityId = this.requireOperatorEntity(user);
    const { type: entityType } = await this.assertEntityActive(entityId);
    const period = await this.prisma.reportingPeriod.findFirst({
      where: { id: dto.periodId, deletedAt: null },
      select: {
        id: true,
        status: true,
        templateId: true,
        template: { select: { status: true, deletedAt: true } },
      },
    });
    if (!period) throw new NotFoundException('Reporting period not found');
    if (period.status !== PeriodStatus.OPEN) {
      throw new BadRequestException('This reporting period is not open for filing');
    }
    // A period is bound to a specific template version. Publishing a newer version ARCHIVES the
    // old one, but the period (and its returns) legitimately stay on that version — only a deleted
    // template is truly unavailable.
    if (period.template.deletedAt) {
      throw new BadRequestException("The period's template is no longer available.");
    }
    // The template must have a section that applies to this operator's type — otherwise the form
    // would be empty for them. startablePeriods already filters these out; guard the direct POST.
    //
    // Deliberately by type only, not by declared services: a return that has not been opened yet
    // has no answers, so nothing is declared. Gating here would lock out exactly the operator who
    // needs to open the draft in order to tick the service in the first place. The service gate
    // belongs on validation and on the form, where there are answers to read.
    const applicable = await this.prisma.templateSection.count({
      where: { templateId: period.templateId, applicableEntityTypes: { has: entityType } },
    });
    if (applicable === 0) {
      throw new BadRequestException('This return does not apply to your entity type.');
    }

    // The current (non-rejected) return for this period, if any, is what we resume.
    const active = await this.prisma.submission.findFirst({
      where: {
        entityId,
        periodId: dto.periodId,
        deletedAt: null,
        status: { not: SubmissionStatus.REJECTED },
      },
      select: { id: true },
    });
    if (active) return this.findOne(user, active.id);

    // A rejected return isn't restarted from scratch — it's revised into a new version.
    const rejected = await this.prisma.submission.findFirst({
      where: {
        entityId,
        periodId: dto.periodId,
        deletedAt: null,
        status: SubmissionStatus.REJECTED,
      },
      select: { id: true },
    });
    if (rejected) {
      throw new BadRequestException(
        'This return was rejected. Open it from your submissions list and choose Revise to resubmit.',
      );
    }

    // A draft the operator deleted earlier still holds this (entity, period, version) slot, because
    // deletion is soft. Revive that row rather than inserting a colliding one: without this, the
    // period is offered again by startablePeriods and every attempt to start it fails forever.
    // The answers are cleared, because the operator asked for this draft to go away.
    const revived = await this.reviveDeletedDraft(entityId, dto.periodId, user.id);
    if (revived) {
      await this.record(AuditAction.SUBMISSION_CREATED, revived, user.id, ctx, {
        periodId: dto.periodId,
        revived: true,
      });
      return this.findOne(user, revived);
    }

    let created: { id: string };
    try {
      created = await this.prisma.submission.create({
        data: {
          entityId,
          periodId: dto.periodId,
          templateId: period.templateId,
          createdById: user.id,
        },
        select: { id: true },
      });
    } catch (e) {
      // A concurrent open created the v1 draft first — resume that one instead of duplicating.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const raced = await this.prisma.submission.findFirst({
          where: {
            entityId,
            periodId: dto.periodId,
            deletedAt: null,
            status: { not: SubmissionStatus.REJECTED },
          },
          select: { id: true },
        });
        if (raced) return this.findOne(user, raced.id);
      }
      throw e;
    }
    await this.record(AuditAction.SUBMISSION_CREATED, created.id, user.id, ctx, {
      entityId,
      periodId: dto.periodId,
    });
    return this.findOne(user, created.id);
  }

  /** Load a draft the caller may edit, or throw (scope + status + period-open). */
  private async loadEditableDraft(user: AuthUser, id: string) {
    const submission = await this.prisma.submission.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        entityId: true,
        templateId: true,
        status: true,
        period: { select: { status: true } },
      },
    });
    if (!submission) throw new NotFoundException('Return not found');
    assertCanAccessEntity(user, submission.entityId);
    await this.assertEntityActive(submission.entityId);
    if (submission.status !== SubmissionStatus.DRAFT) {
      throw new BadRequestException('Only a draft return can be edited');
    }
    if (submission.period.status !== PeriodStatus.OPEN) {
      throw new BadRequestException('The reporting period is not open');
    }
    return submission;
  }

  /** Incrementally save (upsert) answered values on a draft. */
  async saveValues(user: AuthUser, id: string, dto: SaveValuesDto, ctx: RequestContext) {
    const submission = await this.loadEditableDraft(user, id);

    // Every value must target a field that belongs to this submission's template.
    const fields = await this.prisma.templateField.findMany({
      where: { section: { templateId: submission.templateId } },
      select: { id: true },
    });
    const validFieldIds = new Set(fields.map((f) => f.id));
    for (const v of dto.values) {
      if (!validFieldIds.has(v.fieldId)) {
        throw new BadRequestException('One or more fields do not belong to this template');
      }
    }

    await this.writeValues(id, dto.values);
    await this.record(AuditAction.SUBMISSION_UPDATED, id, user.id, ctx, {
      fields: dto.values.length,
    });
    return this.findOne(user, id);
  }

  /** Validate, sign, and submit a draft. Hard validation errors block. */
  async submit(user: AuthUser, id: string, dto: SubmitDto, ctx: RequestContext) {
    const submission = await this.prisma.submission.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        entityId: true,
        templateId: true,
        status: true,
        periodId: true,
        version: true,
        entity: { select: { type: true, name: true } },
        period: { select: { status: true, dueDate: true } },
        template: { select: { name: true } },
        values: {
          select: {
            fieldId: true,
            valueText: true,
            isUnavailable: true,
            unavailableReason: true,
            otherText: true,
            field: { select: { key: true } },
          },
        },
      },
    });
    if (!submission) throw new NotFoundException('Return not found');
    assertCanAccessEntity(user, submission.entityId);
    await this.assertEntityActive(submission.entityId);
    if (submission.status !== SubmissionStatus.DRAFT) {
      throw new BadRequestException('This return has already been submitted');
    }
    if (submission.period.status !== PeriodStatus.OPEN) {
      throw new BadRequestException('The reporting period is not open');
    }

    // Full validation: field-level + configurable cross-field/period-on-period
    // rules (VALIDATION_SPEC §6). Hard issues block; soft issues are stored.
    const result = await this.computeValidation(submission);
    if (result.hard.length > 0) {
      throw new BadRequestException(result.hard.map((h) => h.message));
    }

    const now = new Date();
    const isLate = now > submission.period.dueDate;
    const year = now.getFullYear();

    // Fast-track (Q2): skip the Checker once the entity has 3+ consecutive clean approvals for this
    // template family — but a late return is never fast-tracked, and the Approver always runs.
    const templateName = submission.template.name;
    const streak = await this.prisma.complianceStreak.findUnique({
      where: { entityId_templateName: { entityId: submission.entityId, templateName } },
      select: { count: true },
    });

    // Q2's last condition: no fast-track on the first return after a change in reported services.
    // A new service means a set of questions this operator has not been checked on before, so the
    // streak it built answering different ones says nothing about this return.
    const servicesChanged = await this.servicesChangedSinceLastReturn(submission);

    const fastTrack = !isLate && !servicesChanged && (streak?.count ?? 0) >= 3;
    const firstStage = fastTrack ? ReviewStage.VERIFIER : ReviewStage.CHECKER;

    // The reference number is a per-year sequence derived from a count, so two concurrent submits
    // can compute the same value and collide on the `referenceNumber @unique` constraint. Retry on
    // that specific collision (P2002) with a freshly recomputed sequence rather than surfacing a
    // confusing "already exists" error.
    /**
     * The certificate-based signature, when one was supplied (Q6, Phase 3).
     *
     * Verified here, before anything is written. A signature that does not check out must stop the
     * submission rather than be recorded alongside it: a return carrying a signature nobody can
     * verify is worse than one carrying none, because it looks like it has been signed.
     *
     * The digest is computed from the return as it stands at this moment, so what the signer signed
     * and what is filed are necessarily the same thing.
     */
    let pkiSignature: {
      signatureFormat?: SignatureFormat;
      signatureDigest?: string;
      signatureValue?: string;
      signatureCertId?: string;
    } = {};

    if (dto.signingCertificateId || dto.signature) {
      if (!dto.signingCertificateId || !dto.signature) {
        throw new BadRequestException(
          'A certificate signature needs both the certificate and the signature. Send both, or neither.',
        );
      }
      const certificate = await this.signatures.resolveSigningCertificate(
        user.id,
        dto.signingCertificateId,
      );
      const digest = this.signatures.digestOf({
        entityId: submission.entityId,
        periodId: submission.periodId,
        templateId: submission.templateId,
        version: submission.version,
        values: submission.values.map((v) => ({
          valueText: v.valueText,
          field: { key: v.field.key },
        })),
      });

      const verified = verifySubmissionSignature({
        publicKeyPem: certificate.publicKeyPem,
        algorithm: certificate.algorithm as SignatureAlgorithm,
        signedDigest: digest,
        currentDigest: digest,
        signature: dto.signature,
      });
      if (!verified.ok) {
        throw new BadRequestException(VERIFICATION_MESSAGES[verified.reason!]);
      }

      pkiSignature = {
        signatureFormat: SignatureFormat.PKI,
        signatureDigest: digest,
        signatureValue: dto.signature,
        signatureCertId: certificate.id,
      };
    }

    let referenceNumber = '';
    let assigned = false;
    for (let attempt = 0; attempt < 5 && !assigned; attempt += 1) {
      // Count every reference number ever issued this year — not just those still in SUBMITTED —
      // so the sequence stays monotonic as returns advance through review or are rejected. (A
      // status-only count would shrink and re-issue colliding numbers.) Soft-deleted rows keep
      // their number, so they're counted too.
      const seq =
        (await this.prisma.submission.count({
          where: {
            referenceNumber: { not: null },
            submittedAt: {
              gte: new Date(Date.UTC(year, 0, 1)),
              lt: new Date(Date.UTC(year + 1, 0, 1)),
            },
          },
        })) +
        1 +
        attempt;
      referenceNumber = formatReferenceNumber('SUB', year, seq);
      try {
        // updateMany with `status: DRAFT` in the predicate makes the DRAFT→SUBMITTED transition
        // atomic: two concurrent submits of the same draft can't both win — the loser matches zero
        // rows and is told the return was already submitted, instead of double-writing.
        const res = await this.prisma.submission.updateMany({
          where: { id, status: SubmissionStatus.DRAFT },
          data: {
            status: SubmissionStatus.SUBMITTED,
            reviewStage: firstStage,
            submittedAt: now,
            isLate,
            referenceNumber,
            signedByUserId: user.id,
            signedName: dto.signedName.trim(),
            signedAt: now,
            ...pkiSignature,
            validationWarnings: result.soft as unknown as Prisma.InputJsonValue,
          },
        });
        if (res.count === 0) {
          throw new BadRequestException('This return has already been submitted');
        }
        assigned = true;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }
    if (!assigned) {
      throw new ConflictException(
        'Could not assign a reference number just now. Please try again.',
      );
    }

    // A late submission, or a change in the services being reported, breaks the clean streak
    // straight away (Q2) so the next return cannot fast-track off it either.
    if (isLate || servicesChanged) {
      await this.prisma.complianceStreak.upsert({
        where: { entityId_templateName: { entityId: submission.entityId, templateName } },
        create: { entityId: submission.entityId, templateName, count: 0 },
        update: { count: 0 },
      });
    }

    await this.record(AuditAction.SUBMISSION_SUBMITTED, id, user.id, ctx, {
      referenceNumber,
      isLate,
      fastTracked: fastTrack,
      firstStage,
      warnings: result.soft.length,
    });

    // Let the reviewers at the entry stage know a return is waiting (best-effort; never blocks).
    await this.notifications.returnAwaitingReview({
      submissionId: id,
      stage: firstStage,
      referenceNumber,
      entityName: submission.entity.name,
    });
    return this.findOne(user, id);
  }

  /**
   * Revise a rejected return: create a fresh DRAFT that supersedes the rejected one and carries
   * its answers forward, so the operator edits and resubmits without re-keying everything. The
   * rejected version is retained as history (Q1 versioning).
   */
  async revise(user: AuthUser, id: string, ctx: RequestContext) {
    const entityId = this.requireOperatorEntity(user);
    await this.assertEntityActive(entityId);
    const rejected = await this.prisma.submission.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        entityId: true,
        periodId: true,
        templateId: true,
        status: true,
        version: true,
        period: { select: { status: true } },
        template: { select: { status: true, deletedAt: true } },
        values: {
          select: {
            fieldId: true,
            valueText: true,
            isUnavailable: true,
            unavailableReason: true,
            otherText: true,
          },
        },
        attachments: {
          where: { deletedAt: null },
          select: { kind: true, fileName: true, mimeType: true, sizeBytes: true, storageKey: true },
        },
      },
    });
    if (!rejected) throw new NotFoundException('Return not found');
    assertCanAccessEntity(user, rejected.entityId);
    if (rejected.status !== SubmissionStatus.REJECTED) {
      throw new BadRequestException('Only a rejected return can be revised.');
    }
    if (rejected.period.status !== PeriodStatus.OPEN) {
      throw new BadRequestException('The reporting period is no longer open.');
    }
    // As with a first submission: an archived (superseded) template version is fine — the period
    // is bound to it. Only a deleted template blocks the revision.
    if (rejected.template.deletedAt) {
      throw new BadRequestException("This return's template is no longer available.");
    }

    // A rejected return can only be superseded once. If a revision already exists, resume it only
    // while it's still a draft; once it has been resubmitted (or beyond), this old version is
    // closed history and can't be revised again.
    const existingRevision = await this.prisma.submission.findFirst({
      where: { supersedesId: rejected.id, deletedAt: null },
      select: { id: true, status: true },
    });
    if (existingRevision) {
      if (existingRevision.status === SubmissionStatus.DRAFT) {
        return this.findOne(user, existingRevision.id);
      }
      throw new BadRequestException('This return has already been revised and resubmitted.');
    }

    // A revision the operator started and then deleted still holds `supersedesId @unique`, so a
    // fresh insert would collide and leave the rejected return impossible to revise. Reclaim that
    // row instead, clearing its answers so the operator restarts from the rejected version.
    const deletedRevision = await this.prisma.submission.findFirst({
      where: { supersedesId: rejected.id, deletedAt: { not: null } },
      select: { id: true },
    });
    if (deletedRevision) {
      await this.prisma.$transaction([
        this.prisma.submissionValue.deleteMany({ where: { submissionId: deletedRevision.id } }),
        this.prisma.submissionAttachment.deleteMany({
          where: { submissionId: deletedRevision.id },
        }),
        this.prisma.submission.update({
          where: { id: deletedRevision.id },
          data: { deletedAt: null, status: SubmissionStatus.DRAFT, createdById: user.id },
        }),
      ]);
      await this.copyAttachments(rejected.attachments, deletedRevision.id, user.id);
      return this.findOne(user, deletedRevision.id);
    }

    let created: { id: string };
    try {
      created = await this.prisma.submission.create({
        data: {
          entityId: rejected.entityId,
          periodId: rejected.periodId,
          templateId: rejected.templateId,
          createdById: user.id,
          version: rejected.version + 1,
          supersedesId: rejected.id,
          values: {
            create: rejected.values.map((v) => ({
              fieldId: v.fieldId,
              valueText: v.valueText,
              isUnavailable: v.isUnavailable,
              unavailableReason: v.unavailableReason,
              otherText: v.otherText,
            })),
          },
        },
        select: { id: true },
      });
    } catch (e) {
      // A concurrent revise already created the replacement (unique on supersedesId / version) —
      // resume it rather than erroring.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const raced = await this.prisma.submission.findFirst({
          where: { supersedesId: rejected.id, deletedAt: null },
          select: { id: true },
        });
        if (raced) return this.findOne(user, raced.id);
      }
      throw e;
    }
    // Carry the supporting files forward too, so the operator doesn't have to re-upload them. Each
    // version gets its own independent blob (copied, not shared), so removing a file on the new
    // draft never touches the rejected version's history. Best-effort per file: one unreadable blob
    // is logged and skipped rather than blocking the whole revision.
    await this.copyAttachments(rejected.attachments, created.id, user.id);

    await this.record(AuditAction.SUBMISSION_RESUBMITTED, created.id, user.id, ctx, {
      from: rejected.id,
      version: rejected.version + 1,
    });
    return this.findOne(user, created.id);
  }

  /** Duplicate a rejected return's attachments onto its revised version (fresh blobs + rows). */
  private async copyAttachments(
    source: {
      kind: AttachmentKind;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      storageKey: string;
    }[],
    newSubmissionId: string,
    uploadedById: string,
  ): Promise<void> {
    for (const att of source) {
      try {
        const storageKey = await this.storage.copy(att.storageKey, newSubmissionId);
        await this.prisma.submissionAttachment.create({
          data: {
            submissionId: newSubmissionId,
            kind: att.kind,
            fileName: att.fileName,
            mimeType: att.mimeType,
            sizeBytes: att.sizeBytes,
            storageKey,
            uploadedById,
          },
        });
      } catch (err) {
        this.logger.error(
          `Failed to carry attachment ${att.fileName} to revision ${newSubmissionId}`,
          err as Error,
        );
      }
    }
  }

  /**
   * Dry-run validation: run the full engine against the current saved values
   * and return the issues without submitting. Lets operators fix problems
   * before they sign.
   */
  async validate(
    user: AuthUser,
    id: string,
  ): Promise<{ hard: ValidationResult['hard']; soft: ValidationResult['soft'] }> {
    const submission = await this.prisma.submission.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        entityId: true,
        templateId: true,
        entity: { select: { type: true } },
        period: { select: { dueDate: true } },
        values: {
          select: {
            fieldId: true,
            valueText: true,
            isUnavailable: true,
            unavailableReason: true,
            otherText: true,
          },
        },
      },
    });
    if (!submission) throw new NotFoundException('Return not found');
    assertCanAccessEntity(user, submission.entityId);
    const result = await this.computeValidation(submission);
    return { hard: result.hard, soft: result.soft };
  }

  /**
   * Compose the pure engine with database context: the template's sections,
   * its configurable rules, and the prior period's submitted values (for
   * period-on-period comparison).
   */
  private async computeValidation(submission: {
    id: string;
    entityId: string;
    templateId: string;
    entity: { type: EntityType };
    period: { dueDate: Date };
    values: (SubmittedValue & { fieldId: string })[];
  }): Promise<ValidationResult> {
    const [sections, rules] = await Promise.all([
      this.prisma.templateSection.findMany({
        where: { templateId: submission.templateId },
        select: {
          key: true,
          applicableEntityTypes: true,
          // Which service, if any, gates this section (VALIDATION_SPEC §3).
          requiredServiceCode: true,
          fields: {
            select: {
              id: true,
              key: true,
              label: true,
              dataType: true,
              isMandatory: true,
              allowsOther: true,
              minValue: true,
              maxValue: true,
              // A SERVICE_TYPE answer is what declares a service, so the validator can work out
              // which sections this return is actually being asked.
              referenceCategory: true,
            },
          },
        },
      }),
      this.prisma.templateRule.findMany({
        where: { templateId: submission.templateId },
        orderBy: { order: 'asc' },
        select: { type: true, severity: true, label: true, config: true },
      }),
    ]);

    const vSections: ValidationSection[] = sections.map((s) => ({
      key: s.key,
      applicableEntityTypes: s.applicableEntityTypes,
      requiredServiceCode: s.requiredServiceCode,
      fields: s.fields.map((f) => ({
        id: f.id,
        key: f.key,
        label: f.label,
        dataType: f.dataType,
        isMandatory: f.isMandatory,
        allowsOther: f.allowsOther,
        minValue: f.minValue == null ? null : Number(f.minValue),
        maxValue: f.maxValue == null ? null : Number(f.maxValue),
        referenceCategory: f.referenceCategory,
      })),
    }));
    const fieldKeyById: Record<string, string> = {};
    const fieldLabelByKey: Record<string, string> = {};
    for (const s of sections)
      for (const f of s.fields) {
        fieldKeyById[f.id] = f.key;
        fieldLabelByKey[f.key] = f.label;
      }

    const valuesMap: Record<string, SubmittedValue> = Object.fromEntries(
      submission.values.map((v) => [v.fieldId, v]),
    );

    const ruleInputs: RuleInput[] = rules.map((r) => ({
      type: r.type,
      severity: r.severity,
      label: r.label,
      config: r.config,
    }));

    return runValidation({
      sections: vSections,
      entityType: submission.entity.type,
      values: valuesMap,
      rules: ruleInputs,
      fieldKeyById,
      fieldLabelByKey,
      priorNumericByKey: await this.priorPeriodNumeric(submission),
    });
  }

  /**
   * Whether this return declares a different set of services from the operator's last one (Q2).
   *
   * Compared against the most recent **filed** return for the same questionnaire family, whatever
   * became of it. A rejected return still tells us what the operator said it offered, and using
   * only approved ones would let an operator change its service mix, have that return sent back,
   * and then fast-track the replacement.
   *
   * The first return of all is not a change. There is nothing to have changed from, and treating
   * it as one would deny a new operator a fast-track it has not had the chance to earn anyway —
   * the streak is zero at that point regardless, so it would be a rule with no effect and a
   * confusing explanation.
   */
  private async servicesChangedSinceLastReturn(submission: {
    id: string;
    entityId: string;
    templateId: string;
    values: (SubmittedValue & { fieldId: string })[];
  }): Promise<boolean> {
    const template = await this.prisma.reportingTemplate.findUnique({
      where: { id: submission.templateId },
      select: { name: true },
    });
    if (!template) return false;

    const previous = await this.prisma.submission.findFirst({
      where: {
        entityId: submission.entityId,
        id: { not: submission.id },
        deletedAt: null,
        submittedAt: { not: null },
        template: { name: template.name },
      },
      orderBy: { submittedAt: 'desc' },
      select: {
        values: {
          where: { field: { referenceCategory: SERVICE_CATEGORY } },
          select: { valueText: true, isUnavailable: true, field: { select: { key: true } } },
        },
      },
    });
    // Nothing to compare against: the first return is not a change.
    if (!previous) return false;

    const sections = await this.prisma.templateSection.findMany({
      where: { templateId: submission.templateId },
      select: {
        key: true,
        applicableEntityTypes: true,
        requiredServiceCode: true,
        fields: { select: { id: true, key: true, referenceCategory: true } },
      },
    });

    const nowValues: Record<string, { valueText?: string | null; isUnavailable?: boolean }> = {};
    for (const v of submission.values) {
      nowValues[v.fieldId] = { valueText: v.valueText, isUnavailable: v.isUnavailable };
    }
    const now = declaredServices(sections, nowValues);

    // The previous return's answers come back keyed by field key rather than id, because the
    // questionnaire may have been republished since and the ids will not match.
    const before = new Set<string>();
    for (const v of previous.values) {
      if (v.isUnavailable) continue;
      for (const part of (v.valueText ?? '').split(',')) {
        const code = normaliseServiceCode(part);
        if (code) before.add(code);
      }
    }

    if (now.size !== before.size) return true;
    for (const code of now) if (!before.has(code)) return true;
    return false;
  }

  /**
   * Write a batch of answers in one statement.
   *
   * The obvious shape here is one `upsert` per value inside a transaction, and that is what this
   * was. It costs one database round trip per answer: a 120-question return took about a second per
   * autosave on the deadline-day load harness, and autosave fires every two seconds. A real NCA
   * questionnaire is several times longer than that, so saves would stop keeping up with typing on
   * exactly the afternoon when everybody is typing (Q11, §9).
   *
   * One `INSERT ... ON CONFLICT DO UPDATE` carrying every row does the same work in a single round
   * trip, and the unique index on (submission_id, field_id) is what makes it an upsert. Values are
   * bound as parameters rather than interpolated, so an answer containing a quote is an answer and
   * not a SQL fragment.
   *
   * `id` and `updated_at` are supplied explicitly because neither column has a database default —
   * Prisma normally fills them in on the client, and raw SQL does not go through Prisma's client.
   */
  private async writeValues(
    submissionId: string,
    values: {
      fieldId: string;
      valueText?: string;
      isUnavailable?: boolean;
      unavailableReason?: string;
      otherText?: string;
    }[],
  ): Promise<void> {
    if (values.length === 0) return;

    const now = new Date();
    const rows = values.map(
      (v) =>
        Prisma.sql`(${randomUUID()}::uuid, ${submissionId}::uuid, ${v.fieldId}::uuid, ${
          v.valueText ?? null
        }, ${v.isUnavailable ?? false}, ${v.unavailableReason ?? null}, ${
          v.otherText ?? null
        }, ${now}, ${now})`,
    );

    await this.prisma.$executeRaw`
      INSERT INTO submission_values
        (id, submission_id, field_id, value_text, is_unavailable, unavailable_reason, other_text, created_at, updated_at)
      VALUES ${Prisma.join(rows)}
      ON CONFLICT (submission_id, field_id) DO UPDATE SET
        value_text = EXCLUDED.value_text,
        is_unavailable = EXCLUDED.is_unavailable,
        unavailable_reason = EXCLUDED.unavailable_reason,
        other_text = EXCLUDED.other_text,
        updated_at = EXCLUDED.updated_at
    `;
  }

  /** Prior period's submitted values (keyed by field key) for period-on-period. */
  private async priorPeriodNumeric(submission: {
    id: string;
    entityId: string;
    templateId: string;
    period: { dueDate: Date };
  }): Promise<Record<string, number | null> | null> {
    // Match the baseline by template FAMILY (name), not the exact version. A questionnaire's
    // versions (v1, v2, …) are distinct templateIds, so keying on templateId would break the
    // period-on-period chain every time a template is re-versioned. Field keys are stable across
    // versions, so a prior submission on an earlier version is still a valid baseline.
    const family = await this.prisma.reportingTemplate.findUnique({
      where: { id: submission.templateId },
      select: { name: true },
    });
    if (!family) return null;

    const prior = await this.prisma.submission.findFirst({
      where: {
        entityId: submission.entityId,
        template: { name: family.name },
        // Any prior return that was actually filed (submitted, in review, or approved) is a valid
        // baseline — but never a rejected one. Keying on `status: SUBMITTED` alone would lose the
        // baseline the moment the prior period advanced through review.
        submittedAt: { not: null },
        status: { not: SubmissionStatus.REJECTED },
        deletedAt: null,
        id: { not: submission.id },
        period: { deletedAt: null, dueDate: { lt: submission.period.dueDate } },
      },
      orderBy: { period: { dueDate: 'desc' } },
      select: {
        values: {
          select: { valueText: true, isUnavailable: true, field: { select: { key: true } } },
        },
      },
    });
    if (!prior) return null;
    const map: Record<string, number | null> = {};
    for (const v of prior.values) {
      if (v.isUnavailable) {
        map[v.field.key] = null;
        continue;
      }
      const raw = (v.valueText ?? '').trim();
      const n = Number(raw);
      map[v.field.key] = raw !== '' && !Number.isNaN(n) ? n : null;
    }
    return map;
  }

  /** Soft-delete a draft (submitted returns are retained, not deletable here). */
  async remove(user: AuthUser, id: string, ctx: RequestContext) {
    const submission = await this.prisma.submission.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        entityId: true,
        status: true,
        period: { select: { status: true, deletedAt: true } },
      },
    });
    if (!submission) throw new NotFoundException('Return not found');
    assertCanAccessEntity(user, submission.entityId);
    // Deleting a draft is a write like any other, so it takes the same guard as editing one.
    // Without this an operator barred from editing (entity suspended, period closed) could still
    // destroy the draft, and an Authority admin could delete an operator's work in progress.
    await this.assertEntityActive(submission.entityId);
    if (submission.status !== SubmissionStatus.DRAFT) {
      throw new BadRequestException('A submitted return cannot be deleted');
    }
    if (submission.period.deletedAt || submission.period.status !== PeriodStatus.OPEN) {
      throw new BadRequestException('The reporting period is not open');
    }
    await this.prisma.submission.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.record(AuditAction.SUBMISSION_DELETED, id, user.id, ctx);
    return { message: 'Submission deleted' };
  }

  private record(
    action: AuditAction,
    submissionId: string,
    actorId: string,
    ctx: RequestContext,
    metadata?: Prisma.InputJsonValue,
  ) {
    return this.audit.record({
      action,
      actorId,
      entityType: 'Submission',
      entityId: submissionId,
      metadata,
      context: ctx,
    });
  }
}
