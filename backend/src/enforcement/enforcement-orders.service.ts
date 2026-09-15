import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  EnforcementOrderStatus,
  EnforcementOrderType,
  Prisma,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import { entityScopeFilter } from '../common/utils/data-scope.util';
import {
  ApproveEnforcementOrderDto,
  DraftEnforcementOrderDto,
  RevokeEnforcementOrderDto,
} from './dto/enforcement-order.dto';

const orderSelect = {
  id: true,
  caseId: true,
  type: true,
  status: true,
  reason: true,
  legalBasis: true,
  effectiveFrom: true,
  durationDays: true,
  boardMinuteRef: true,
  boardDecidedAt: true,
  approvedAt: true,
  revokedAt: true,
  revokedNote: true,
  createdAt: true,
  // Named, because "who suspended this licence" is the first question anybody asks of an order.
  draftedBy: { select: { id: true, firstName: true, lastName: true } },
  approvedBy: { select: { id: true, firstName: true, lastName: true } },
  revokedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.EnforcementOrderSelect;

/**
 * Formal enforcement orders: Tier 3's non-financial sanctions (Q3; NCA, 3 September 2026).
 *
 * A penalty is a figure and lives on the schedule. Suspending, cancelling or shortening a licence
 * is a decision, and a decision needs an author, a legal basis, a date and somebody senior enough
 * to take it. NCA set the last of those out precisely: *"Sign-off escalates beyond the officer
 * chain: DG approves a suspension; the Board approves a cancellation."*
 *
 * Two rules carry that, and both are enforced here rather than left to the screen:
 *
 * 1. **Drafting is not approving.** An order has no effect until it is approved, and the two acts
 *    are recorded separately — the approval is the one an operator will contest.
 * 2. **An officer cannot approve their own draft.** The point of escalating sign-off is that a
 *    second person looked at it. One account doing both is the officer chain again, wearing a hat.
 */
@Injectable()
export class EnforcementOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Every order on a case, newest first — and only if the caller is entitled to the case.
   *
   * An operator may read the orders against its own licence, and must not be able to read another
   * operator's. Scoping by the case's entity rather than trusting the id in the URL is the whole
   * of that: a case id is a UUID, not a secret, and "hard to guess" is not an access rule.
   *
   * A caller with no entity is Authority staff and sees whichever case they asked for.
   */
  async findForCase(user: AuthUser, caseId: string) {
    const scoped = entityScopeFilter(user);
    const owner = await this.prisma.enforcementCase.findFirst({
      where: { id: caseId, ...(scoped ? { entityId: scoped } : {}) },
      select: { id: true },
    });
    // The same answer whether the case belongs to somebody else or does not exist. Telling the two
    // apart would let an operator map the Authority's caseload by trying ids.
    if (!owner) throw new NotFoundException('Enforcement case not found');

    return this.prisma.enforcementOrder.findMany({
      where: { caseId },
      select: orderSelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  async draft(user: AuthUser, caseId: string, dto: DraftEnforcementOrderDto, ctx: RequestContext) {
    const existing = await this.prisma.enforcementCase.findUnique({
      where: { id: caseId },
      select: { id: true, entityId: true },
    });
    if (!existing) throw new NotFoundException('Enforcement case not found');

    /*
     * A cancellation does not run for a period; it ends the licence. Accepting a duration on one
     * would leave the file saying "cancelled for 90 days", which is not a thing the Act provides
     * for and which somebody would later have to interpret.
     */
    if (dto.type === EnforcementOrderType.CANCELLATION && dto.durationDays !== undefined) {
      throw new BadRequestException('A cancellation does not have a duration. Leave it blank.');
    }
    if (dto.type !== EnforcementOrderType.CANCELLATION && dto.durationDays === undefined) {
      throw new BadRequestException('Say how long this order runs for, in days.');
    }

    const order = await this.prisma.enforcementOrder.create({
      data: {
        caseId,
        type: dto.type,
        reason: dto.reason.trim(),
        legalBasis: dto.legalBasis.trim(),
        effectiveFrom: new Date(dto.effectiveFrom),
        durationDays: dto.durationDays ?? null,
        draftedById: user.id,
      },
      select: orderSelect,
    });

    await this.record(AuditAction.ENFORCEMENT_ORDER_DRAFTED, order.id, user.id, ctx, {
      caseId,
      entityId: existing.entityId,
      type: dto.type,
    });
    return order;
  }

  async approve(
    user: AuthUser,
    orderId: string,
    dto: ApproveEnforcementOrderDto,
    ctx: RequestContext,
  ) {
    const order = await this.prisma.enforcementOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        type: true,
        status: true,
        draftedById: true,
        case: { select: { entityId: true } },
      },
    });
    if (!order) throw new NotFoundException('Enforcement order not found');
    if (order.status !== EnforcementOrderStatus.DRAFT) {
      throw new BadRequestException('Only a draft order can be approved.');
    }

    /*
     * The whole point of escalated sign-off is that a second person looked at it. An officer
     * approving their own draft is the officer chain again with a different label on it, and it is
     * the first thing anybody reviewing a contested suspension would look for.
     */
    if (order.draftedById === user.id) {
      throw new ForbiddenException(
        'An order has to be approved by somebody other than the person who drafted it.',
      );
    }

    /*
     * Who may approve, from NCA's answer.
     *
     * A suspension or a licence-shortening needs the DG, which in this system is the Supervisor
     * role. A cancellation needs the Board — and the Board is a body that meets and minutes its
     * decisions rather than an account that signs in, so what is required is the minute that
     * authorised it. The officer entering it is still recorded, which is a different fact from who
     * decided, and both matter.
     */
    const isCancellation = order.type === EnforcementOrderType.CANCELLATION;
    if (isCancellation) {
      if (!dto.boardMinuteRef || !dto.boardDecidedAt) {
        throw new BadRequestException(
          'A cancellation needs the Board minute that authorised it: the reference and the date.',
        );
      }
    } else if (user.role !== Role.SUPERVISOR && user.role !== Role.ADMIN) {
      throw new ForbiddenException('A suspension is approved by the Director General.');
    }

    const approved = await this.prisma.enforcementOrder.update({
      where: { id: orderId },
      data: {
        status: EnforcementOrderStatus.APPROVED,
        approvedById: user.id,
        approvedAt: new Date(),
        boardMinuteRef: isCancellation ? dto.boardMinuteRef!.trim() : null,
        boardDecidedAt: isCancellation ? new Date(dto.boardDecidedAt!) : null,
      },
      select: orderSelect,
    });

    await this.record(AuditAction.ENFORCEMENT_ORDER_APPROVED, orderId, user.id, ctx, {
      entityId: order.case.entityId,
      type: order.type,
      boardMinuteRef: isCancellation ? dto.boardMinuteRef : undefined,
    });
    return approved;
  }

  async revoke(
    user: AuthUser,
    orderId: string,
    dto: RevokeEnforcementOrderDto,
    ctx: RequestContext,
  ) {
    const order = await this.prisma.enforcementOrder.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, type: true, case: { select: { entityId: true } } },
    });
    if (!order) throw new NotFoundException('Enforcement order not found');
    if (order.status !== EnforcementOrderStatus.APPROVED) {
      throw new BadRequestException('Only an order that is in force can be withdrawn.');
    }

    // Revoked, never deleted: it had legal effect while it stood, and the record of that is the
    // point of keeping it.
    const revoked = await this.prisma.enforcementOrder.update({
      where: { id: orderId },
      data: {
        status: EnforcementOrderStatus.REVOKED,
        revokedById: user.id,
        revokedAt: new Date(),
        revokedNote: dto.note.trim(),
      },
      select: orderSelect,
    });

    await this.record(AuditAction.ENFORCEMENT_ORDER_REVOKED, orderId, user.id, ctx, {
      entityId: order.case.entityId,
      type: order.type,
    });
    return revoked;
  }

  private record(
    action: AuditAction,
    orderId: string,
    actorId: string,
    context: RequestContext,
    metadata: Prisma.InputJsonObject,
  ) {
    return this.audit.record({
      action,
      actorId,
      entityType: 'EnforcementOrder',
      entityId: orderId,
      metadata,
      context,
    });
  }
}
