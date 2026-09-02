import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, DocumentExpiryStage, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService, UploadedFile } from '../files/storage.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import { paginate, toSkipTake } from '../common/utils/pagination.util';
import {
  assertCanAccessEntity,
  entityScopeFilter,
  resolveTargetEntityId,
} from '../common/utils/data-scope.util';
import { StorageConfig } from '../config/configuration';
import { validateDocument } from './document-validation';
import { DocumentQueryDto, UploadDocumentDto } from './dto/document.dto';

/** Default warning window: a licence renewal needs lead time, so warn two months out. */
export const DEFAULT_EXPIRY_WARNING_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Columns returned to clients — never the storage key. */
const documentSelect = {
  id: true,
  entityId: true,
  kind: true,
  title: true,
  reference: true,
  issuedAt: true,
  expiresAt: true,
  version: true,
  supersedesId: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  createdAt: true,
  entity: { select: { id: true, name: true, type: true } },
  uploadedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
} satisfies Prisma.DocumentRecordSelect;

/**
 * The licence and certificate repository. Documents are versioned rather than edited: replacing one
 * files a new version that supersedes the previous, so what was on record at any past date stays
 * recoverable. Expiry dates are swept and alerted on, once per stage.
 */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);
  private readonly maxFileBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    config: ConfigService,
  ) {
    this.maxFileBytes = config.get<StorageConfig>('storage')!.maxFileBytes;
  }

  // --- Repository ----------------------------------------------------------

  async findAll(user: AuthUser, query: DocumentQueryDto) {
    const scoped = entityScopeFilter(user);
    const where: Prisma.DocumentRecordWhereInput = {
      deletedAt: null,
      // Only the current version of each document; superseded versions stay as history.
      supersededBy: null,
      entityId: scoped ?? query.entityId,
      kind: query.kind,
      ...(query.expiringOnly === 'true'
        ? { expiresAt: { not: null, lte: this.warningCutoff() } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { reference: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const orderBy = { [query.sort]: query.order } as Prisma.DocumentRecordOrderByWithRelationInput;
    const { skip, take } = toSkipTake(query);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.documentRecord.findMany({ where, select: documentSelect, orderBy, skip, take }),
      this.prisma.documentRecord.count({ where }),
    ]);
    return paginate(
      rows.map((r) => ({ ...r, expiry: this.expiryOf(r.expiresAt) })),
      total,
      query,
    );
  }

  async upload(
    user: AuthUser,
    dto: UploadDocumentDto,
    file: UploadedFile | undefined,
    ctx: RequestContext,
  ) {
    const entityId = resolveTargetEntityId(user, dto.entityId);
    if (!file) throw new BadRequestException('No file was uploaded');
    if (file.size > this.maxFileBytes) {
      throw new BadRequestException(
        `The file is too large. The maximum size is ${Math.floor(this.maxFileBytes / (1024 * 1024))} MB.`,
      );
    }
    const problem = validateDocument(file.originalname, file.buffer);
    if (problem) throw new BadRequestException(problem);

    const issuedAt = dto.issuedAt ? new Date(dto.issuedAt) : null;
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (issuedAt && expiresAt && expiresAt <= issuedAt) {
      throw new BadRequestException('The expiry date must be after the issue date.');
    }

    // Replacing an existing document: check it, and inherit its version number.
    let version = 1;
    if (dto.supersedesId) {
      const previous = await this.prisma.documentRecord.findFirst({
        where: { id: dto.supersedesId, deletedAt: null },
        select: { id: true, entityId: true, version: true, supersededBy: { select: { id: true } } },
      });
      if (!previous) throw new NotFoundException('The document being replaced was not found');
      assertCanAccessEntity(user, previous.entityId);
      if (previous.entityId !== entityId) {
        throw new BadRequestException('A document can only be replaced within the same entity.');
      }
      if (previous.supersededBy) {
        throw new BadRequestException('That document has already been replaced.');
      }
      version = previous.version + 1;
    }

    const storageKey = await this.storage.save(
      file.buffer,
      `documents/${entityId}`,
      file.originalname,
    );

    let created;
    try {
      created = await this.prisma.documentRecord.create({
        data: {
          entityId,
          kind: dto.kind,
          title: dto.title.trim(),
          reference: dto.reference?.trim() || null,
          issuedAt,
          expiresAt,
          version,
          supersedesId: dto.supersedesId ?? null,
          fileName: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          storageKey,
          uploadedById: user.id,
        },
        select: documentSelect,
      });
    } catch (e) {
      // Two concurrent replacements of the same document race on `supersedesId @unique`.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('That document has already been replaced.');
      }
      throw e;
    }

    await this.record(
      dto.supersedesId ? AuditAction.DOCUMENT_REPLACED : AuditAction.DOCUMENT_UPLOADED,
      created.id,
      user.id,
      ctx,
      { entityId, kind: dto.kind, title: created.title, version },
    );
    return { ...created, expiry: this.expiryOf(created.expiresAt) };
  }

  /** Resolve a document for download (scope-checked), returning its metadata plus a read stream. */
  async download(user: AuthUser, id: string) {
    const doc = await this.prisma.documentRecord.findFirst({
      where: { id, deletedAt: null },
      select: { fileName: true, mimeType: true, storageKey: true, entityId: true },
    });
    if (!doc) throw new NotFoundException('Document not found');
    assertCanAccessEntity(user, doc.entityId);
    return {
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      stream: this.storage.stream(doc.storageKey),
    };
  }

  /** Soft-delete: the row and its blob are retained for the audit and retention trail. */
  async remove(user: AuthUser, id: string, ctx: RequestContext) {
    const doc = await this.prisma.documentRecord.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, entityId: true, title: true },
    });
    if (!doc) throw new NotFoundException('Document not found');
    assertCanAccessEntity(user, doc.entityId);
    await this.prisma.documentRecord.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.record(AuditAction.DOCUMENT_DELETED, id, user.id, ctx, { title: doc.title });
    return { message: 'Document removed' };
  }

  // --- Expiry ---------------------------------------------------------------

  private warningCutoff(withinDays = DEFAULT_EXPIRY_WARNING_DAYS, now = new Date()): Date {
    return new Date(now.getTime() + withinDays * DAY_MS);
  }

  /**
   * The computed expiry state of a document, so a reader sees the same signal everywhere without
   * the client re-deriving it.
   */
  private expiryOf(
    expiresAt: Date | null,
    withinDays = DEFAULT_EXPIRY_WARNING_DAYS,
    now = new Date(),
  ): { stage: DocumentExpiryStage | null; daysRemaining: number | null } {
    if (!expiresAt) return { stage: null, daysRemaining: null };
    const daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS);
    if (daysRemaining < 0) return { stage: DocumentExpiryStage.EXPIRED, daysRemaining };
    if (daysRemaining <= withinDays) {
      return { stage: DocumentExpiryStage.EXPIRING, daysRemaining };
    }
    return { stage: null, daysRemaining };
  }

  /**
   * Alert on documents approaching or past their expiry date. Idempotent: a document is only
   * alerted when it moves into a new stage, so re-running the sweep sends nothing new. Superseded
   * documents are skipped — the renewal that replaced them is the one that matters.
   */
  async sweepExpiries(withinDays = DEFAULT_EXPIRY_WARNING_DAYS) {
    const candidates = await this.prisma.documentRecord.findMany({
      where: {
        deletedAt: null,
        supersededBy: null,
        expiresAt: { not: null, lte: this.warningCutoff(withinDays) },
      },
      select: {
        id: true,
        entityId: true,
        title: true,
        expiresAt: true,
        alertedStage: true,
      },
    });

    let alerted = 0;
    for (const doc of candidates) {
      const { stage } = this.expiryOf(doc.expiresAt, withinDays);
      if (!stage || stage === doc.alertedStage) continue;
      try {
        // The read above is a first pass, not a claim on the row. Two sweeps running at once (two
        // instances, or an administrator pressing the button while the nightly job runs) both see
        // an unalerted document and would both write to the operator. Making the *update* the guard
        // closes that: whichever transaction lands second matches nothing, and sends nothing.
        const claimed = await this.prisma.documentRecord.updateMany({
          where: { id: doc.id, alertedStage: doc.alertedStage },
          data: { alertedStage: stage },
        });
        if (claimed.count === 0) continue;

        await this.notifications.documentExpiry({
          entityId: doc.entityId,
          documentTitle: doc.title,
          expiresOn: doc.expiresAt!.toISOString().slice(0, 10),
          expired: stage === DocumentExpiryStage.EXPIRED,
        });
        alerted += 1;
      } catch (err) {
        this.logger.error(`Failed to alert on document ${doc.id}`, err as Error);
      }
    }
    if (alerted > 0) this.logger.log(`Sent ${alerted} document expiry alert(s)`);
    return { checked: candidates.length, alerted };
  }

  private record(
    action: AuditAction,
    documentId: string,
    actorId: string,
    ctx: RequestContext,
    metadata?: Record<string, unknown>,
  ) {
    return this.audit.record({
      action,
      actorId,
      entityType: 'DocumentRecord',
      entityId: documentId,
      metadata: metadata as Prisma.InputJsonValue,
      context: ctx,
    });
  }
}
