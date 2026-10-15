import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  EnforcementStatus,
  PaymentKind,
  PaymentMethod,
  Prisma,
  SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LevyService } from '../levy/levy.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import { assertCanAccessEntity, entityScopeFilter } from '../common/utils/data-scope.util';
import { paginate, toSkipTake } from '../common/utils/pagination.util';
import { formatReferenceNumber } from '../common/utils/reference-number.util';
import { moneyLabel } from '../exports/export-format';
import { addNote, addSummary, createDocument, toBuffer } from '../exports/pdf-document';
import {
  Charge,
  PaymentLine,
  SettledCharge,
  keyOf,
  levyKey,
  penaltyKey,
  settle,
  totals,
} from './balances';
import {
  BalancesQueryDto,
  PaymentQueryDto,
  RecordPaymentDto,
  ReversePaymentDto,
} from './dto/payment.dto';

/**
 * The Authority's own calendar day.
 *
 * "Not in the future" has to be judged in Juba, not in UTC. Money that lands at one in the morning
 * local time is still yesterday in UTC, and a check against the UTC date would refuse a payment
 * dated the day it truly arrived.
 */
const AUTHORITY_TIME_ZONE = 'Africa/Juba';

function todayInJuba(): string {
  // en-CA formats as YYYY-MM-DD, which compares correctly as a string.
  return new Intl.DateTimeFormat('en-CA', { timeZone: AUTHORITY_TIME_ZONE }).format(new Date());
}

const METHOD_LABELS: Record<PaymentMethod, string> = {
  BANK_TRANSFER: 'Bank transfer',
  CHEQUE: 'Cheque',
  MOBILE_MONEY: 'Mobile money',
};

/** What a payment row carries when it is shown to anybody. */
const paymentSelect = {
  id: true,
  receiptNumber: true,
  kind: true,
  amount: true,
  paidOn: true,
  method: true,
  bankReference: true,
  note: true,
  recordedAt: true,
  reversedAt: true,
  reversalReason: true,
  entity: { select: { id: true, name: true, type: true } },
  period: { select: { id: true, label: true } },
  enforcementCase: {
    select: { id: true, reason: true, period: { select: { id: true, label: true } } },
  },
  recordedBy: { select: { id: true, firstName: true, lastName: true } },
  reversedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.PaymentSelect;

type PaymentRow = Prisma.PaymentGetPayload<{ select: typeof paymentSelect }>;

function present(p: PaymentRow) {
  return { ...p, amount: Number(p.amount), paidOn: p.paidOn.toISOString().slice(0, 10) };
}

/** "the 2026 Q1 levy" or "the penalty on the 2025 Q3 case", for messages and receipts. */
function describeCharge(p: Pick<PaymentRow, 'kind' | 'period' | 'enforcementCase'>): string {
  return p.kind === PaymentKind.LEVY
    ? `Regulatory levy, ${p.period?.label ?? 'unknown period'}`
    : `Penalty, missed deadline for ${p.enforcementCase?.period.label ?? 'unknown period'}`;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly levy: LevyService,
  ) {}

  // --- What is owed ---------------------------------------------------------------------------

  /**
   * Every charge in scope, with what has been paid against it.
   *
   * An operator is held to its own record whatever it asks for. The Authority sees every operator,
   * or one, and gets a line per operator as well as per charge.
   */
  async balances(user: AuthUser, query: BalancesQueryDto) {
    const entityId = entityScopeFilter(user) ?? query.entityId;
    const charges = await this.charges(entityId, query.periodId);

    const payments = await this.prisma.payment.findMany({
      where: {
        entityId,
        ...(query.periodId
          ? {
              OR: [{ periodId: query.periodId }, { enforcementCase: { periodId: query.periodId } }],
            }
          : {}),
      },
      select: {
        kind: true,
        entityId: true,
        periodId: true,
        enforcementCaseId: true,
        amount: true,
        reversedAt: true,
        entity: { select: { id: true, name: true, type: true } },
        period: { select: { id: true, label: true, dueDate: true } },
        enforcementCase: {
          select: { period: { select: { id: true, label: true, dueDate: true } } },
        },
      },
    });

    /*
     * Money held against something that is no longer a charge.
     *
     * A levy that can no longer be worked out (the rate was withdrawn, say) or a penalty that was
     * waived after it was paid is due nothing, but the money that arrived for it did arrive. It is
     * added as a charge of zero, so it shows as overpaid rather than vanishing from every total.
     */
    const known = new Set(charges.map((c) => c.key));
    for (const p of payments) {
      if (p.reversedAt) continue;
      const key = keyOf({ ...p, amount: Number(p.amount) });
      if (known.has(key)) continue;
      known.add(key);
      const period = p.kind === PaymentKind.LEVY ? p.period! : p.enforcementCase!.period;
      charges.push({
        kind: p.kind,
        key,
        entity: p.entity,
        period,
        caseId: p.enforcementCaseId,
        due: 0,
      });
    }

    const lines: PaymentLine[] = payments.map((p) => ({ ...p, amount: Number(p.amount) }));
    const settled = settle(charges, lines)
      // A charge of nothing with nothing paid is not a line anybody needs to read.
      .filter((c) => c.due > 0 || c.paid > 0)
      .sort(
        (a, b) =>
          b.period.dueDate.getTime() - a.period.dueDate.getTime() ||
          a.entity.name.localeCompare(b.entity.name) ||
          a.kind.localeCompare(b.kind),
      );

    const byEntity = new Map<string, SettledCharge[]>();
    for (const c of settled) byEntity.set(c.entity.id, [...(byEntity.get(c.entity.id) ?? []), c]);

    return {
      totals: totals(settled),
      operators: [...byEntity.values()]
        .map((rows) => ({ entity: rows[0]!.entity, ...totals(rows) }))
        .sort(
          (a, b) => b.outstanding - a.outstanding || a.entity.name.localeCompare(b.entity.name),
        ),
      charges: settled,
    };
  }

  /**
   * The charges themselves: each period's levy from approved returns, and each assessed penalty.
   *
   * The levy comes from `LevyService.assessPeriod`, the same calculation the levy screen shows. A
   * second calculation here would be a second answer, and the first time the two differed an
   * operator would be told it owed money it had already paid.
   */
  private async charges(entityId?: string, periodId?: string): Promise<Charge[]> {
    const approved = await this.prisma.submission.findMany({
      where: {
        status: SubmissionStatus.APPROVED,
        deletedAt: null,
        supersededBy: null,
        entityId,
        periodId,
      },
      select: { periodId: true },
      distinct: ['periodId'],
    });

    const charges: Charge[] = [];
    for (const { periodId: pid } of approved) {
      const assessment = await this.levy.assessPeriod(pid, entityId);
      if (!assessment.period) continue;
      for (const row of assessment.rows) {
        // No rate for the period means no levy has been assessed, which is not the same as zero.
        if (row.levyDue === null || row.levyDue <= 0) continue;
        charges.push({
          kind: PaymentKind.LEVY,
          key: levyKey(row.entity.id, pid),
          entity: row.entity,
          period: {
            id: assessment.period.id,
            label: assessment.period.label,
            dueDate: assessment.period.dueDate,
          },
          caseId: null,
          due: row.levyDue,
        });
      }
    }

    const cases = await this.prisma.enforcementCase.findMany({
      where: {
        entityId,
        periodId,
        penaltyAssessedAt: { not: null },
        status: { not: EnforcementStatus.WAIVED },
      },
      select: {
        id: true,
        penaltyAmount: true,
        entity: { select: { id: true, name: true, type: true } },
        period: { select: { id: true, label: true, dueDate: true } },
      },
    });
    for (const c of cases) {
      charges.push({
        kind: PaymentKind.PENALTY,
        key: penaltyKey(c.id),
        entity: c.entity,
        period: c.period,
        caseId: c.id,
        due: Number(c.penaltyAmount ?? 0),
      });
    }
    return charges;
  }

  // --- The record of payments -----------------------------------------------------------------

  async list(user: AuthUser, query: PaymentQueryDto) {
    const where: Prisma.PaymentWhereInput = {
      entityId: entityScopeFilter(user) ?? query.entityId,
      kind: query.kind,
      ...(query.periodId
        ? { OR: [{ periodId: query.periodId }, { enforcementCase: { periodId: query.periodId } }] }
        : {}),
      ...(query.hideReversed ? { reversedAt: null } : {}),
    };
    const { skip, take } = toSkipTake(query);
    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        select: paymentSelect,
        // The receipt number breaks ties, so two payments on the same day keep a stable order
        // across pages.
        orderBy: [{ [query.sort]: query.order }, { receiptNumber: query.order }],
        skip,
        take,
      }),
      this.prisma.payment.count({ where }),
    ]);
    return paginate(rows.map(present), total, query);
  }

  // --- Recording and reversing ----------------------------------------------------------------

  async record(user: AuthUser, dto: RecordPaymentDto, ctx: RequestContext) {
    const entity = await this.prisma.entity.findFirst({
      where: { id: dto.entityId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!entity) throw new NotFoundException('That operator does not exist.');

    if (dto.kind === PaymentKind.LEVY) {
      await this.assertLevyIsOwed(dto.entityId, dto.periodId!, entity.name);
    } else {
      await this.assertPenaltyIsPayable(dto.entityId, dto.enforcementCaseId!);
    }

    const paidOn = dto.paidOn.slice(0, 10);
    if (paidOn > todayInJuba()) {
      throw new BadRequestException(
        'That date is in the future. Enter the day the money arrived, from the bank statement.',
      );
    }

    /*
     * The same transfer typed in twice.
     *
     * One bank reference can legitimately appear on several payments: an operator often settles
     * two quarters' levy with one transfer, which is recorded as two payments against two charges.
     * The same reference, for the same amount, against the same charge, is a second keying of one
     * payment, and recording it would double the money on the books.
     */
    const bankReference = dto.bankReference.trim();
    const duplicate = await this.prisma.payment.findFirst({
      where: {
        entityId: dto.entityId,
        kind: dto.kind,
        periodId: dto.kind === PaymentKind.LEVY ? dto.periodId : null,
        enforcementCaseId: dto.kind === PaymentKind.PENALTY ? dto.enforcementCaseId : null,
        amount: new Prisma.Decimal(dto.amount),
        bankReference: { equals: bankReference, mode: 'insensitive' },
        reversedAt: null,
      },
      select: { receiptNumber: true },
    });
    if (duplicate) {
      throw new ConflictException(
        `This payment is already recorded, as receipt ${duplicate.receiptNumber}. If it really ` +
          'arrived twice, the second transfer will have its own bank reference.',
      );
    }

    const year = Number(todayInJuba().slice(0, 4));
    let created: PaymentRow | null = null;
    // Payments are never deleted, so the count is a true sequence; the retry covers two officers
    // recording at the same moment and computing the same next number.
    for (let attempt = 0; attempt < 5 && !created; attempt += 1) {
      const seq =
        (await this.prisma.payment.count({
          where: { receiptNumber: { startsWith: `NCA/RCT/${year}/` } },
        })) +
        1 +
        attempt;
      try {
        created = await this.prisma.payment.create({
          data: {
            receiptNumber: formatReferenceNumber('RCT', year, seq),
            entityId: dto.entityId,
            kind: dto.kind,
            periodId: dto.kind === PaymentKind.LEVY ? dto.periodId : null,
            enforcementCaseId: dto.kind === PaymentKind.PENALTY ? dto.enforcementCaseId : null,
            amount: new Prisma.Decimal(dto.amount),
            paidOn: new Date(`${paidOn}T00:00:00.000Z`),
            method: dto.method,
            bankReference,
            note: dto.note?.trim() || null,
            recordedById: user.id,
          },
          select: paymentSelect,
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }
    if (!created) {
      throw new ConflictException('Another payment was recorded at the same moment. Try again.');
    }

    await this.audit.record({
      action: AuditAction.PAYMENT_RECORDED,
      actorId: user.id,
      entityType: 'Payment',
      entityId: created.id,
      context: ctx,
      metadata: {
        receiptNumber: created.receiptNumber,
        operator: entity.name,
        kind: created.kind,
        charge: describeCharge(created),
        amount: dto.amount,
        bankReference,
      },
    });

    return present(created);
  }

  private async assertLevyIsOwed(entityId: string, periodId: string, entityName: string) {
    const period = await this.prisma.reportingPeriod.findFirst({
      where: { id: periodId, deletedAt: null },
      select: { label: true },
    });
    if (!period) throw new NotFoundException('That reporting period does not exist.');

    const assessment = await this.levy.assessPeriod(periodId, entityId);
    const row = assessment.rows.find((r) => r.entity.id === entityId);
    if (!row) {
      throw new BadRequestException(
        `${entityName} has no approved return for ${period.label}, so no levy has been assessed ` +
          'for it yet. A levy payment can be recorded once the return is approved.',
      );
    }
    if (row.levyDue === null) {
      throw new BadRequestException(
        `No levy rate covers ${period.label}, so no levy has been worked out for it. Add the rate ` +
          'on the Revenue and levy screen first.',
      );
    }
  }

  private async assertPenaltyIsPayable(entityId: string, caseId: string) {
    const found = await this.prisma.enforcementCase.findFirst({
      where: { id: caseId },
      select: {
        entityId: true,
        status: true,
        penaltyAmount: true,
        penaltyAssessedAt: true,
        remedyDueAt: true,
      },
    });
    if (!found || found.entityId !== entityId) {
      throw new NotFoundException('That compliance case does not exist for this operator.');
    }
    if (found.status === EnforcementStatus.WAIVED) {
      throw new BadRequestException('This penalty was waived, so there is nothing to pay.');
    }
    if (!found.penaltyAssessedAt || found.penaltyAmount === null) {
      const until = found.remedyDueAt
        ? ` The remedy notice runs until ${found.remedyDueAt.toISOString().slice(0, 10)}.`
        : '';
      throw new BadRequestException(
        `This penalty is not payable yet, so a payment cannot be recorded against it.${until}`,
      );
    }
  }

  /**
   * Undo a payment that should not have been recorded, keeping the record that it was.
   *
   * Never by whoever recorded it. One officer able to both enter money and remove it could make
   * any receipt disappear; two, each with their name against their half, is the control.
   */
  async reverse(user: AuthUser, id: string, dto: ReversePaymentDto, ctx: RequestContext) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      select: { id: true, receiptNumber: true, recordedById: true, reversedAt: true },
    });
    if (!payment) throw new NotFoundException('That payment does not exist.');
    if (payment.reversedAt) {
      throw new ConflictException(`Receipt ${payment.receiptNumber} has already been reversed.`);
    }
    if (payment.recordedById === user.id) {
      throw new ForbiddenException(
        'A payment has to be reversed by somebody other than the person who recorded it.',
      );
    }

    const reversed = await this.prisma.payment.update({
      where: { id },
      data: { reversedAt: new Date(), reversedById: user.id, reversalReason: dto.reason.trim() },
      select: paymentSelect,
    });

    await this.audit.record({
      action: AuditAction.PAYMENT_REVERSED,
      actorId: user.id,
      entityType: 'Payment',
      entityId: id,
      context: ctx,
      metadata: { receiptNumber: payment.receiptNumber, reason: dto.reason.trim() },
    });

    return present(reversed);
  }

  // --- The receipt ----------------------------------------------------------------------------

  async receipt(user: AuthUser, id: string): Promise<{ buffer: Buffer; filename: string }> {
    const p = await this.prisma.payment.findUnique({ where: { id }, select: paymentSelect });
    if (!p) throw new NotFoundException('That payment does not exist.');
    assertCanAccessEntity(user, p.entity.id);

    const doc = createDocument('Receipt for payment', p.receiptNumber);
    addSummary(doc, [
      ['Receipt number', p.receiptNumber],
      ['Received from', p.entity.name],
      ['Amount', moneyLabel(Number(p.amount))],
      ['In payment of', describeCharge(p)],
      ['Date received', p.paidOn.toISOString().slice(0, 10)],
      ['Method', METHOD_LABELS[p.method]],
      ['Bank reference', p.bankReference],
      ['Recorded by', `${p.recordedBy.firstName} ${p.recordedBy.lastName}`.trim()],
      ['Recorded on', p.recordedAt.toISOString().slice(0, 10)],
    ]);

    if (p.reversedAt) {
      /*
       * A reversed payment's receipt is still issued, never withheld, because somebody may be
       * holding the original and needs to be able to check it. It says plainly that it no longer
       * stands, on the face of the document rather than only in the portal.
       */
      addNote(
        doc,
        `REVERSED on ${p.reversedAt.toISOString().slice(0, 10)} by ` +
          `${p.reversedBy?.firstName ?? ''} ${p.reversedBy?.lastName ?? ''}`.trim() +
          `. This receipt no longer stands. Reason given: ${p.reversalReason}`,
      );
    } else {
      addNote(
        doc,
        'Issued by the National Communication Authority on recording the payment above against ' +
          'the bank statement. Quote the receipt number in any correspondence about it.',
      );
    }

    return {
      buffer: await toBuffer(doc),
      filename: `receipt-${p.receiptNumber.replace(/\//g, '-')}.pdf`,
    };
  }
}
