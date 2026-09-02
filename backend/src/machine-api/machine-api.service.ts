import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Role, SubmissionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubmissionsService } from '../submissions/submissions.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import { periodPhase } from '../common/utils/period-timeline.util';
import type { MachineCaller } from './machine-auth.guard';
import { MachineSaveValuesDto, MachineStartReturnDto, MachineSubmitDto } from './dto/machine.dto';

/** Machine traffic has no browser behind it; the audit trail says so rather than inventing one. */
const MACHINE_CONTEXT: RequestContext = { userAgent: 'machine-api' };

/**
 * The system-to-system API (Q10, Phase 3).
 *
 * Every write here goes through `SubmissionsService`, the same code a person at a keyboard goes
 * through. That is the whole design: a return filed by a machine meets the same validation, the
 * same period rules, the same workflow and the same audit trail as one filed by hand. A second
 * path with its own rules would drift, and the half that drifted would be the one nobody was
 * watching.
 *
 * What this service adds is the translation. A machine has an entity and a scope, not a session,
 * and it addresses questions by key rather than by field id — so an integration written last
 * quarter keeps working when a questionnaire is republished with new ids.
 */
@Injectable()
export class MachineApiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly submissions: SubmissionsService,
  ) {}

  /**
   * The machine caller as the rest of the portal understands it.
   *
   * `id` is the credential's own service account, which is a real user row: submissions need an
   * author, and "filed by the Billing System integration" is a better answer than a blank. The
   * role is the narrowest one that can file — a machine cannot review, approve, or manage a team,
   * and giving it a role that could would be handing it authority nobody granted.
   */
  private async asUser(caller: MachineCaller): Promise<AuthUser> {
    const client = await this.prisma.apiClient.findUnique({
      where: { id: caller.id },
      select: { serviceUser: { select: { id: true, email: true } } },
    });
    if (!client) throw new NotFoundException('That credential no longer exists.');
    return {
      id: client.serviceUser.id,
      email: client.serviceUser.email,
      role: Role.OPERATOR_SUBMITTER,
      entityId: caller.entityId,
    };
  }

  whoami(caller: MachineCaller) {
    return {
      clientId: caller.clientId,
      name: caller.name,
      entityId: caller.entityId,
      scopes: caller.scopes,
    };
  }

  /**
   * Periods this operator can still file for: open, not yet closed, and belonging to a
   * questionnaire that applies to this kind of operator.
   */
  async openPeriods(caller: MachineCaller) {
    const entity = await this.prisma.entity.findFirst({
      where: { id: caller.entityId, deletedAt: null },
      select: { type: true },
    });
    if (!entity) throw new NotFoundException('That operator record no longer exists.');

    const periods = await this.prisma.reportingPeriod.findMany({
      where: {
        deletedAt: null,
        status: 'OPEN',
        template: {
          deletedAt: null,
          status: 'PUBLISHED',
          sections: { some: { applicableEntityTypes: { has: entity.type } } },
        },
      },
      orderBy: { dueDate: 'asc' },
      select: {
        id: true,
        label: true,
        frequency: true,
        periodStart: true,
        periodEnd: true,
        dueDate: true,
        graceDays: true,
        template: { select: { id: true, name: true, version: true } },
      },
    });

    // What is already filed, so a caller does not have to work it out from a second request.
    const filed = await this.prisma.submission.findMany({
      where: {
        entityId: caller.entityId,
        deletedAt: null,
        supersededBy: null,
        periodId: { in: periods.map((p) => p.id) },
      },
      select: { periodId: true, status: true, referenceNumber: true },
    });
    const byPeriod = new Map(filed.map((f) => [f.periodId, f]));

    return {
      periods: periods.map((p) => ({
        ...p,
        // The phase, not just the date: "overdue" is the answer an integration actually wants.
        phase: periodPhase('OPEN', p.dueDate, p.graceDays),
        filed: byPeriod.get(p.id) ?? null,
      })),
    };
  }

  /**
   * The questions on a period's questionnaire, by key, with the units and rules that apply.
   *
   * Sections gated on a service are marked rather than hidden. An integration is building a
   * request, not filling in a form: it needs to know that a section exists and what would switch
   * it on, or it will simply never send those figures and nobody will know why. The validator
   * still enforces the gate when the return is filed (VALIDATION_SPEC §3, §6.1).
   */
  async questions(caller: MachineCaller, periodId: string) {
    const entity = await this.prisma.entity.findFirst({
      where: { id: caller.entityId, deletedAt: null },
      select: { type: true },
    });
    if (!entity) throw new NotFoundException('That operator record no longer exists.');

    const period = await this.prisma.reportingPeriod.findFirst({
      where: { id: periodId, deletedAt: null },
      select: { id: true, label: true, templateId: true },
    });
    if (!period) throw new NotFoundException('That reporting period does not exist.');

    const sections = await this.prisma.templateSection.findMany({
      where: {
        templateId: period.templateId,
        applicableEntityTypes: { has: entity.type },
      },
      orderBy: { order: 'asc' },
      select: {
        key: true,
        title: true,
        requiredServiceCode: true,
        fields: {
          orderBy: { order: 'asc' },
          select: {
            key: true,
            label: true,
            dataType: true,
            unit: true,
            decimals: true,
            isMandatory: true,
            minValue: true,
            maxValue: true,
            allowsOther: true,
          },
        },
      },
    });

    return {
      period: { id: period.id, label: period.label },
      sections: sections.map((section) => ({
        ...section,
        /**
         * When set, this section only applies if the operator declares this service in its
         * answers. Send the figures only when it does; sending them otherwise is refused.
         */
        requiredServiceCode: section.requiredServiceCode,
      })),
    };
  }

  async returns(caller: MachineCaller) {
    const rows = await this.prisma.submission.findMany({
      where: { entityId: caller.entityId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        referenceNumber: true,
        status: true,
        version: true,
        isLate: true,
        submittedAt: true,
        createdAt: true,
        period: { select: { id: true, label: true, dueDate: true } },
      },
    });
    return { returns: rows };
  }

  async startReturn(caller: MachineCaller, dto: MachineStartReturnDto) {
    const user = await this.asUser(caller);
    const draft = await this.submissions.getOrCreateDraft(
      user,
      { periodId: dto.periodId },
      MACHINE_CONTEXT,
    );
    return draft;
  }

  /**
   * Put values into a draft, addressed by question key.
   *
   * A key that is not on this questionnaire is refused by name rather than ignored. Silently
   * dropping it would leave an integrator convinced they had filed a figure they had not, and the
   * first anyone would know is a rejection weeks later.
   */
  async saveValues(caller: MachineCaller, id: string, dto: MachineSaveValuesDto) {
    const user = await this.asUser(caller);

    const submission = await this.prisma.submission.findFirst({
      where: { id, deletedAt: null, entityId: caller.entityId },
      select: { id: true, templateId: true },
    });
    if (!submission) throw new NotFoundException('That return does not exist.');

    const fields = await this.prisma.templateField.findMany({
      where: { section: { templateId: submission.templateId } },
      select: { id: true, key: true },
    });
    const byKey = new Map(fields.map((f) => [f.key, f.id]));

    const unknown = dto.values.map((v) => v.key).filter((key) => !byKey.has(key));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `These questions are not on this questionnaire: ${[...new Set(unknown)].join(', ')}`,
      );
    }

    return this.submissions.saveValues(
      user,
      id,
      {
        values: dto.values.map((v) => ({
          fieldId: byKey.get(v.key)!,
          valueText: v.value,
          isUnavailable: v.isUnavailable,
          unavailableReason: v.unavailableReason,
          otherText: v.otherText,
        })),
      },
      MACHINE_CONTEXT,
    );
  }

  /**
   * File the return.
   *
   * The signature recorded against it is the integration's own name, because that is who filed it.
   * Q6 asks for an authenticated action bound to the submission with a timestamp, and a machine
   * filing satisfies that in the same way a person's does — the difference is only who signed.
   */
  async submit(caller: MachineCaller, id: string, dto: MachineSubmitDto) {
    const user = await this.asUser(caller);
    const result = await this.submissions.submit(
      user,
      id,
      { signedName: dto.signedName?.trim() || caller.name },
      MACHINE_CONTEXT,
    );
    return result;
  }

  /** Whether a status counts as filed, for the caller's benefit. */
  static isFiled(status: SubmissionStatus): boolean {
    return status !== SubmissionStatus.DRAFT;
  }
}
