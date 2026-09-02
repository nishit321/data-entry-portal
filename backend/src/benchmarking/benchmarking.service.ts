import { Injectable, NotFoundException } from '@nestjs/common';
import {
  EntityStatus,
  EntityType,
  FieldType,
  Prisma,
  SubmissionStatus,
  TemplateStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { isAuthorityRole } from '../common/utils/data-scope.util';
import { summarisePeers, type PeerSummary, type PeerValue } from './peer-statistics';
import { BenchmarkQueryDto, IndicatorBenchmarkQueryDto } from './dto/benchmark-query.dto';

/** Only figures can be benchmarked; text and dates cannot be ranked. */
const NUMERIC_TYPES: FieldType[] = [
  FieldType.INTEGER,
  FieldType.DECIMAL,
  FieldType.MONETARY,
  FieldType.PERCENTAGE,
];

/** A named per-entity row. Built for Authority readers only, and never sent to an operator. */
export interface NamedRow {
  entity: { id: string; name: string; type: EntityType };
  value: number | null;
}

export interface ComplianceRow extends NamedRow {
  filed: number;
  onTime: number;
  late: number;
  approved: number;
  rejected: number;
  onTimeRate: number | null;
  approvalRate: number | null;
}

/**
 * Operator benchmarking (Phase 2): where one operator stands against comparable operators, on
 * compliance behaviour and on the figures it reports.
 *
 * The whole module turns on one rule, enforced here rather than in the client: **an operator never
 * receives another operator's figure**. Authority readers get named rows; operators get their own
 * standing plus aggregates that survive `peer-statistics`' disclosure control. The two audiences
 * share one response shape, and the `rows` array is simply empty for an operator — a client that
 * forgets to check the role still cannot render what it was never sent.
 */
@Injectable()
export class BenchmarkingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve the peer group: comparable operators, active, not deleted.
   *
   * An operator is always compared against its own type — ranking an ISP's subscribers against an
   * MNO's would produce a number that means nothing. The Authority may narrow to a type or look
   * across the whole sector, which is a fair comparison for compliance behaviour if not for volumes.
   */
  private async peerGroup(user: AuthUser, query: BenchmarkQueryDto) {
    const authority = isAuthorityRole(user.role);
    let entityType = authority ? query.entityType : undefined;
    let subjectId: string | undefined = authority ? query.entityId : (user.entityId ?? undefined);

    if (!authority) {
      if (!user.entityId) throw new NotFoundException('Your account is not linked to an operator.');
      const own = await this.prisma.entity.findUnique({
        where: { id: user.entityId },
        select: { type: true },
      });
      if (!own) throw new NotFoundException('We could not find your operator record.');
      entityType = own.type;
      subjectId = user.entityId;
    }

    const entities = await this.prisma.entity.findMany({
      where: { deletedAt: null, status: EntityStatus.ACTIVE, type: entityType },
      select: { id: true, name: true, type: true },
      orderBy: { name: 'asc' },
    });

    return { authority, entityType: entityType ?? null, subjectId, entities };
  }

  /**
   * How an operator's filing behaviour compares: how much it filed, how much of that was on time,
   * and how much was approved.
   *
   * Three metrics are returned together rather than behind a picker. They answer one question
   * between them — is this operator keeping up? — and reading them apart invites the wrong
   * conclusion from a good approval rate on two filings.
   */
  async compliance(user: AuthUser, query: BenchmarkQueryDto) {
    const { authority, entityType, subjectId, entities } = await this.peerGroup(user, query);
    if (entities.length === 0) {
      return this.emptyReport(entityType, authority);
    }

    const entityIds = entities.map((e) => e.id);
    const where: Prisma.SubmissionWhereInput = {
      deletedAt: null,
      supersededBy: null,
      entityId: { in: entityIds },
      templateId: query.templateId,
      periodId: query.periodId,
      submittedAt: { not: null },
    };

    const [byTimeliness, byStatus] = await Promise.all([
      this.prisma.submission.groupBy({
        by: ['entityId', 'isLate'],
        where,
        _count: true,
        orderBy: { entityId: 'asc' },
      }),
      this.prisma.submission.groupBy({
        by: ['entityId', 'status'],
        where,
        _count: true,
        orderBy: { entityId: 'asc' },
      }),
    ]);

    const rows: ComplianceRow[] = entities.map((entity) => {
      const count = (isLate: boolean) =>
        byTimeliness.find((r) => r.entityId === entity.id && r.isLate === isLate)?._count ?? 0;
      const statusCount = (status: SubmissionStatus) =>
        byStatus.find((r) => r.entityId === entity.id && r.status === status)?._count ?? 0;

      const onTime = count(false);
      const late = count(true);
      const filed = onTime + late;
      const approved = statusCount(SubmissionStatus.APPROVED);
      const rejected = statusCount(SubmissionStatus.REJECTED);
      const decided = approved + rejected;

      return {
        entity,
        // `value` is unused for compliance rows; each metric has its own column below.
        value: null,
        filed,
        onTime,
        late,
        approved,
        rejected,
        onTimeRate: filed > 0 ? onTime / filed : null,
        approvalRate: decided > 0 ? approved / decided : null,
      };
    });

    const summarise = (pick: (row: ComplianceRow) => number | null): PeerSummary =>
      summarisePeers(this.toPeerValues(rows, pick), subjectId ?? '');

    return {
      peerGroup: { entityType, size: entities.length },
      subjectId: subjectId ?? null,
      metrics: {
        filings: summarise((r) => (r.filed > 0 ? r.filed : null)),
        onTimeRate: summarise((r) => r.onTimeRate),
        approvalRate: summarise((r) => r.approvalRate),
      },
      // Named figures are an Authority view. An operator is sent an empty list, not a filtered one.
      rows: authority ? rows : [],
    };
  }

  /**
   * The questions that can be benchmarked: every numeric field on a published questionnaire.
   *
   * Sourced from the templates rather than a curated list, so a question added to a questionnaire
   * is comparable the day it is published without anyone remembering to register it here.
   */
  async indicators(query: BenchmarkQueryDto) {
    const fields = await this.prisma.templateField.findMany({
      where: {
        dataType: { in: NUMERIC_TYPES },
        section: {
          template: {
            deletedAt: null,
            status: TemplateStatus.PUBLISHED,
            id: query.templateId,
          },
        },
      },
      select: {
        key: true,
        label: true,
        unit: true,
        isLevyBasis: true,
        section: {
          select: {
            title: true,
            template: { select: { id: true, name: true, version: true } },
          },
        },
      },
      orderBy: [{ section: { order: 'asc' } }, { order: 'asc' }],
    });

    // One questionnaire can be published in several versions; the same question should appear once.
    const seen = new Map<string, (typeof fields)[number]>();
    for (const field of fields) {
      const key = `${field.section.template.name}::${field.key}`;
      const existing = seen.get(key);
      if (!existing || field.section.template.version > existing.section.template.version) {
        seen.set(key, field);
      }
    }

    return {
      indicators: [...seen.values()].map((f) => ({
        fieldKey: f.key,
        label: f.label,
        unit: f.unit,
        isLevyBasis: f.isLevyBasis,
        section: f.section.title,
        template: { id: f.section.template.id, name: f.section.template.name },
      })),
    };
  }

  /**
   * One reported figure compared across the peer group, for a single reporting period.
   *
   * Only **approved** figures are compared. A benchmark built on unreviewed numbers would rank
   * operators on figures the Authority has not stood behind, and one typo would reorder the table.
   */
  async indicator(user: AuthUser, query: IndicatorBenchmarkQueryDto) {
    const { authority, entityType, subjectId, entities } = await this.peerGroup(user, query);
    if (entities.length === 0) {
      return { ...this.emptyIndicatorReport(entityType, authority), period: null, field: null };
    }

    const field = await this.prisma.templateField.findFirst({
      where: {
        key: query.fieldKey,
        dataType: { in: NUMERIC_TYPES },
        section: { template: { deletedAt: null, status: TemplateStatus.PUBLISHED } },
      },
      select: {
        key: true,
        label: true,
        unit: true,
        section: { select: { template: { select: { id: true, name: true } } } },
      },
      orderBy: { section: { template: { version: 'desc' } } },
    });
    if (!field) {
      throw new NotFoundException('That question is not on any published questionnaire.');
    }

    // Default to the most recent period that actually has approved returns behind it, so the
    // screen opens on a comparison rather than on an empty current quarter.
    const period = await this.prisma.reportingPeriod.findFirst({
      where: {
        deletedAt: null,
        id: query.periodId,
        template: { name: field.section.template.name },
        submissions: {
          some: {
            deletedAt: null,
            supersededBy: null,
            status: SubmissionStatus.APPROVED,
            entityId: { in: entities.map((e) => e.id) },
          },
        },
      },
      select: { id: true, label: true, dueDate: true },
      orderBy: { dueDate: 'desc' },
    });

    if (!period) {
      return {
        ...this.emptyIndicatorReport(entityType, authority),
        period: null,
        field: { key: field.key, label: field.label, unit: field.unit },
      };
    }

    const values = await this.prisma.submissionValue.findMany({
      where: {
        isUnavailable: false,
        valueText: { not: null },
        field: { key: query.fieldKey },
        submission: {
          deletedAt: null,
          supersededBy: null,
          status: SubmissionStatus.APPROVED,
          periodId: period.id,
          entityId: { in: entities.map((e) => e.id) },
        },
      },
      select: { valueText: true, submission: { select: { entityId: true } } },
    });

    const byEntity = new Map<string, number>();
    for (const value of values) {
      const parsed = Number(value.valueText);
      if (Number.isFinite(parsed)) byEntity.set(value.submission.entityId, parsed);
    }

    const rows: NamedRow[] = entities.map((entity) => ({
      entity,
      value: byEntity.get(entity.id) ?? null,
    }));

    return {
      peerGroup: { entityType, size: entities.length },
      subjectId: subjectId ?? null,
      period,
      field: { key: field.key, label: field.label, unit: field.unit },
      summary: summarisePeers(
        this.toPeerValues(rows, (r) => r.value),
        subjectId ?? '',
      ),
      // Named figures are the commercially sensitive part (Q4). Operators receive an empty list.
      rows: authority ? rows : [],
      /** How many operators in the group actually have an approved figure for this period. */
      reporting: rows.filter((r) => r.value !== null).length,
    };
  }

  /**
   * Rows to peer values, dropping anyone with nothing to compare.
   *
   * An operator that filed nothing must not enter the median as a zero: "did not report" and
   * "reported none" are different answers, and averaging the first as the second understates the
   * whole group.
   */
  private toPeerValues<T extends NamedRow>(
    rows: T[],
    pick: (row: T) => number | null,
  ): PeerValue[] {
    return rows.flatMap((row) => {
      const value = pick(row);
      return value === null
        ? []
        : [{ entityId: row.entity.id, entityName: row.entity.name, value }];
    });
  }

  private emptyReport(entityType: EntityType | null, authority: boolean) {
    const blank: PeerSummary = {
      groupSize: 0,
      value: null,
      rank: null,
      shareOfTotal: null,
      median: null,
      mean: null,
      withheld: true,
    };
    return {
      peerGroup: { entityType, size: 0 },
      subjectId: null,
      metrics: { filings: blank, onTimeRate: blank, approvalRate: blank },
      rows: authority ? [] : [],
    };
  }

  private emptyIndicatorReport(entityType: EntityType | null, authority: boolean) {
    return {
      peerGroup: { entityType, size: 0 },
      subjectId: null,
      summary: {
        groupSize: 0,
        value: null,
        rank: null,
        shareOfTotal: null,
        median: null,
        mean: null,
        withheld: true,
      } as PeerSummary,
      rows: authority ? [] : [],
      reporting: 0,
    };
  }
}
