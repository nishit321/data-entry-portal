import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AttachmentKind,
  AuditAction,
  EntityStatus,
  PeriodStatus,
  SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import { assertCanAccessEntity, isOperatorRole } from '../common/utils/data-scope.util';
import { StorageConfig } from '../config/configuration';
import { StorageService, UploadedFile } from './storage.service';
import { validateAttachment } from './attachment-validation';

/** Columns returned for an attachment — never the storage key (internal) or blob. */
const attachmentSelect = {
  id: true,
  submissionId: true,
  kind: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  uploadedById: true,
  createdAt: true,
};

@Injectable()
export class AttachmentsService {
  private readonly maxFileBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    config: ConfigService,
  ) {
    this.maxFileBytes = config.get<StorageConfig>('storage')!.maxFileBytes;
  }

  /** Attachments can only be added or removed while the return is an editable draft. */
  private async assertEditableDraft(user: AuthUser, submissionId: string) {
    const submission = await this.prisma.submission.findFirst({
      where: { id: submissionId, deletedAt: null },
      select: {
        id: true,
        entityId: true,
        status: true,
        period: { select: { status: true } },
        entity: { select: { status: true } },
      },
    });
    if (!submission) throw new NotFoundException('Return not found');
    assertCanAccessEntity(user, submission.entityId);
    if (!isOperatorRole(user.role)) {
      throw new ForbiddenException('Only the operator can change the attachments on a return');
    }
    if (submission.entity.status !== EntityStatus.ACTIVE) {
      throw new ForbiddenException(
        "Your entity isn't active, so you can't work on returns right now. Contact the Authority.",
      );
    }
    if (submission.status !== SubmissionStatus.DRAFT) {
      throw new BadRequestException('Attachments can only be changed while the return is a draft');
    }
    if (submission.period.status !== PeriodStatus.OPEN) {
      throw new BadRequestException('The reporting period is not open');
    }
    return submission;
  }

  async upload(
    user: AuthUser,
    submissionId: string,
    kind: AttachmentKind,
    file: UploadedFile | undefined,
    ctx: RequestContext,
  ) {
    await this.assertEditableDraft(user, submissionId);
    if (!file) throw new BadRequestException('No file was uploaded');
    if (file.size > this.maxFileBytes) {
      throw new BadRequestException(
        `The file is too large. The maximum size is ${Math.floor(this.maxFileBytes / (1024 * 1024))} MB.`,
      );
    }
    const problem = validateAttachment(kind, file.originalname, file.buffer);
    if (problem) throw new BadRequestException(problem);

    const storageKey = await this.storage.save(file.buffer, submissionId, file.originalname);
    const attachment = await this.prisma.submissionAttachment.create({
      data: {
        submissionId,
        kind,
        fileName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storageKey,
        uploadedById: user.id,
      },
      select: attachmentSelect,
    });
    await this.audit.record({
      action: AuditAction.ATTACHMENT_UPLOADED,
      actorId: user.id,
      entityType: 'Submission',
      entityId: submissionId,
      metadata: { attachmentId: attachment.id, fileName: file.originalname, kind },
      context: ctx,
    });
    return attachment;
  }

  /** List a submission's attachments (scope-checked; readable by the owner and by Authority). */
  async list(user: AuthUser, submissionId: string) {
    const submission = await this.prisma.submission.findFirst({
      where: { id: submissionId, deletedAt: null },
      select: { id: true, entityId: true },
    });
    if (!submission) throw new NotFoundException('Return not found');
    assertCanAccessEntity(user, submission.entityId);
    return this.prisma.submissionAttachment.findMany({
      where: { submissionId, deletedAt: null },
      select: attachmentSelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Resolve an attachment for download (scope-checked), returning its metadata + a read stream. */
  async download(user: AuthUser, submissionId: string, attachmentId: string) {
    const attachment = await this.prisma.submissionAttachment.findFirst({
      where: { id: attachmentId, submissionId, deletedAt: null },
      select: {
        fileName: true,
        mimeType: true,
        storageKey: true,
        submission: { select: { entityId: true } },
      },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');
    assertCanAccessEntity(user, attachment.submission.entityId);
    return {
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      stream: this.storage.stream(attachment.storageKey),
    };
  }

  async remove(user: AuthUser, submissionId: string, attachmentId: string, ctx: RequestContext) {
    await this.assertEditableDraft(user, submissionId);
    const attachment = await this.prisma.submissionAttachment.findFirst({
      where: { id: attachmentId, submissionId, deletedAt: null },
      select: { id: true, fileName: true },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');
    // Soft-delete: the row (and blob) are retained for the audit/retention trail.
    await this.prisma.submissionAttachment.update({
      where: { id: attachmentId },
      data: { deletedAt: new Date() },
    });
    await this.audit.record({
      action: AuditAction.ATTACHMENT_DELETED,
      actorId: user.id,
      entityType: 'Submission',
      entityId: submissionId,
      metadata: { attachmentId, fileName: attachment.fileName },
      context: ctx,
    });
    return { message: 'Attachment removed' };
  }
}
