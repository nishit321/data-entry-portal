import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, ComplaintStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import { paginate, toSkipTake } from '../common/utils/pagination.util';
import { formatReferenceNumber } from '../common/utils/reference-number.util';
import { generateRawToken, hashToken } from '../common/utils/token.util';
import {
  ComplaintQueryDto,
  FileComplaintDto,
  TrackComplaintDto,
  UpdateComplaintStatusDto,
} from './dto/complaint.dto';

/**
 * What a member of the public may read back about their own complaint. Deliberately narrow: the
 * status they are tracking, and nothing that would turn a leaked reference into a disclosure. Their
 * own contact details are not echoed, and internal handling is not exposed beyond the note the
 * Authority writes for them.
 */
const publicComplaintSelect = {
  referenceNumber: true,
  category: true,
  status: true,
  subject: true,
  resolutionNote: true,
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
} satisfies Prisma.ComplaintSelect;

/** The Authority's view: the full case, minus the tracking-code hash, which nobody needs to read. */
const complaintSelect = {
  id: true,
  referenceNumber: true,
  category: true,
  status: true,
  subject: true,
  description: true,
  complainantName: true,
  complainantEmail: true,
  complainantPhone: true,
  resolutionNote: true,
  resolvedAt: true,
  createdAt: true,
  updatedAt: true,
  aboutEntity: { select: { id: true, name: true, type: true } },
  handledBy: { select: { id: true, firstName: true, lastName: true, email: true } },
} satisfies Prisma.ComplaintSelect;

/** How each status is worded to the citizen, who never sees the enum. */
const STATUS_LABELS: Record<ComplaintStatus, string> = {
  [ComplaintStatus.RECEIVED]: 'received',
  [ComplaintStatus.IN_REVIEW]: 'in review',
  [ComplaintStatus.RESOLVED]: 'resolved',
  [ComplaintStatus.CLOSED]: 'closed',
};

/** Statuses that end a case; reaching one stamps `resolvedAt`. */
const TERMINAL_STATUSES: ComplaintStatus[] = [ComplaintStatus.RESOLVED, ComplaintStatus.CLOSED];

@Injectable()
export class ComplaintsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // --- Public intake --------------------------------------------------------

  /**
   * File a complaint. Returns the reference number and the raw tracking code — the only time the
   * code is ever visible, since only its hash is stored.
   */
  async file(dto: FileComplaintDto, ctx: RequestContext) {
    if (dto.aboutEntityId) {
      const entity = await this.prisma.entity.findFirst({
        where: { id: dto.aboutEntityId, deletedAt: null },
        select: { id: true },
      });
      if (!entity) throw new BadRequestException('We could not find that operator.');
    }

    const trackingCode = generateRawToken();
    const year = new Date().getFullYear();

    // The reference is a per-year sequence derived from a count, so two concurrent filings can
    // compute the same value and collide on the unique index. Retry with a recomputed sequence.
    let complaint: { referenceNumber: string } | null = null;
    for (let attempt = 0; attempt < 5 && !complaint; attempt += 1) {
      const seq =
        (await this.prisma.complaint.count({
          where: {
            createdAt: {
              gte: new Date(Date.UTC(year, 0, 1)),
              lt: new Date(Date.UTC(year + 1, 0, 1)),
            },
          },
        })) +
        1 +
        attempt;
      try {
        complaint = await this.prisma.complaint.create({
          data: {
            referenceNumber: formatReferenceNumber('CMP', year, seq),
            trackingCodeHash: hashToken(trackingCode),
            category: dto.category,
            subject: dto.subject.trim(),
            description: dto.description.trim(),
            complainantName: dto.complainantName?.trim() || null,
            complainantEmail: dto.complainantEmail?.trim().toLowerCase() || null,
            complainantPhone: dto.complainantPhone?.trim() || null,
            aboutEntityId: dto.aboutEntityId ?? null,
          },
          select: { referenceNumber: true },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }
    if (!complaint) {
      throw new BadRequestException('We could not file that just now. Please try again.');
    }

    // The filer is anonymous, so there is no actor to attribute this to.
    await this.audit.record({
      action: AuditAction.COMPLAINT_FILED,
      actorId: null,
      entityType: 'Complaint',
      entityId: complaint.referenceNumber,
      metadata: { category: dto.category },
      context: ctx,
    });

    await this.notifyAuthority(complaint.referenceNumber, dto);

    return {
      referenceNumber: complaint.referenceNumber,
      trackingCode,
      message:
        'Keep your reference number and tracking code. You need both to check progress, and the code is not shown again.',
    };
  }

  /**
   * Track a complaint from the public side. Both the reference and the tracking code must match:
   * the reference alone is sequential and guessable, so it is not a credential.
   */
  async track(dto: TrackComplaintDto) {
    const complaint = await this.prisma.complaint.findUnique({
      where: { referenceNumber: dto.referenceNumber.trim() },
      select: { ...publicComplaintSelect, trackingCodeHash: true },
    });
    // One message for "no such reference" and "wrong code" alike, so this cannot be used to
    // discover which reference numbers exist.
    if (!complaint || complaint.trackingCodeHash !== hashToken(dto.trackingCode.trim())) {
      throw new NotFoundException(
        'We could not find a complaint with that reference number and tracking code.',
      );
    }
    // Return the public projection explicitly, so the hash cannot ride along by accident.
    return {
      referenceNumber: complaint.referenceNumber,
      category: complaint.category,
      status: complaint.status,
      subject: complaint.subject,
      resolutionNote: complaint.resolutionNote,
      createdAt: complaint.createdAt,
      updatedAt: complaint.updatedAt,
      resolvedAt: complaint.resolvedAt,
    };
  }

  // --- Authority ------------------------------------------------------------

  async findAll(query: ComplaintQueryDto) {
    const where: Prisma.ComplaintWhereInput = {
      status: query.status,
      category: query.category,
      aboutEntityId: query.aboutEntityId,
      ...(query.search
        ? {
            OR: [
              { referenceNumber: { contains: query.search, mode: 'insensitive' } },
              { subject: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const orderBy = { [query.sort]: query.order } as Prisma.ComplaintOrderByWithRelationInput;
    const { skip, take } = toSkipTake(query);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.complaint.findMany({ where, select: complaintSelect, orderBy, skip, take }),
      this.prisma.complaint.count({ where }),
    ]);
    return paginate(rows, total, query);
  }

  async findOne(id: string) {
    const complaint = await this.prisma.complaint.findUnique({
      where: { id },
      select: complaintSelect,
    });
    if (!complaint) throw new NotFoundException('Complaint not found');
    return complaint;
  }

  async updateStatus(
    user: AuthUser,
    id: string,
    dto: UpdateComplaintStatusDto,
    ctx: RequestContext,
  ) {
    const existing = await this.prisma.complaint.findUnique({
      where: { id },
      select: { id: true, status: true, referenceNumber: true, complainantEmail: true },
    });
    if (!existing) throw new NotFoundException('Complaint not found');
    if (existing.status === dto.status && !dto.resolutionNote) {
      throw new BadRequestException('That complaint is already at this status.');
    }

    const complaint = await this.prisma.complaint.update({
      where: { id },
      data: {
        status: dto.status,
        resolutionNote: dto.resolutionNote?.trim() ?? undefined,
        handledById: user.id,
        // Stamp when the case ends, and clear it if it is reopened for more work.
        resolvedAt: TERMINAL_STATUSES.includes(dto.status) ? new Date() : null,
      },
      select: complaintSelect,
    });

    await this.audit.record({
      action: AuditAction.COMPLAINT_STATUS_CHANGED,
      actorId: user.id,
      entityType: 'Complaint',
      entityId: id,
      metadata: { from: existing.status, to: dto.status },
      context: ctx,
    });

    // A citizen has no account and no bell, so the only way to reach them is the address they
    // chose to leave. Filing anonymously stays possible; they just track it themselves instead.
    await this.notifications.complaintStatusChanged({
      email: existing.complainantEmail,
      referenceNumber: existing.referenceNumber,
      statusLabel: STATUS_LABELS[dto.status],
      note: dto.resolutionNote?.trim() || null,
    });
    return complaint;
  }

  /** Best-effort: a notification failure must never stop a citizen's complaint being filed. */
  private async notifyAuthority(referenceNumber: string, dto: FileComplaintDto) {
    let aboutEntityName: string | null = null;
    if (dto.aboutEntityId) {
      const entity = await this.prisma.entity.findUnique({
        where: { id: dto.aboutEntityId },
        select: { name: true },
      });
      aboutEntityName = entity?.name ?? null;
    }
    await this.notifications.complaintReceived({
      referenceNumber,
      subject: dto.subject.trim(),
      aboutEntityName,
    });
  }
}
