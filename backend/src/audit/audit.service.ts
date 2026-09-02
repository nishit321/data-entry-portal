import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RequestContext } from '../common/utils/request-context.util';
import { paginate, toSkipTake } from '../common/utils/pagination.util';
import { AuditQueryDto } from './dto/audit-query.dto';

export interface AuditEntry {
  action: AuditAction;
  actorId?: string | null;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
  context?: RequestContext;
}

/**
 * Columns returned for an audit record. A safe, explicit select — every field
 * here is a real column on the model. The actor is joined so a reader sees who
 * acted without a second lookup; it is null for system/anonymous events.
 */
const auditLogSelect = {
  id: true,
  action: true,
  entityType: true,
  entityId: true,
  metadata: true,
  requestId: true,
  ipAddress: true,
  userAgent: true,
  createdAt: true,
  actor: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
} satisfies Prisma.AuditLogSelect;

/**
 * Writes append-only audit records. Audit failures are logged but never block
 * or roll back the business operation that triggered them.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: entry.action,
          actorId: entry.actorId ?? null,
          entityType: entry.entityType,
          entityId: entry.entityId,
          metadata: entry.metadata,
          ipAddress: entry.context?.ipAddress,
          userAgent: entry.context?.userAgent,
          requestId: entry.context?.requestId,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to write audit log for action ${entry.action}`, err as Error);
    }
  }

  /**
   * Paginated read of the audit trail for Authority investigators. The log is
   * append-only, so the filters only narrow the view; nothing is ever hidden for
   * correctness. Newest first by default.
   */
  async findAll(query: AuditQueryDto) {
    // Inclusive created-date range: from start-of-day to end-of-day (UTC).
    const createdAt =
      query.from || query.to
        ? {
            ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
            ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
          }
        : undefined;

    const where: Prisma.AuditLogWhereInput = {
      action: query.action,
      entityType: query.entityType,
      entityId: query.entityId,
      actorId: query.actorId,
      createdAt,
    };

    const orderBy = { [query.sort]: query.order } as Prisma.AuditLogOrderByWithRelationInput;
    const { skip, take } = toSkipTake(query);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({ where, select: auditLogSelect, orderBy, skip, take }),
      this.prisma.auditLog.count({ where }),
    ]);

    // Resolve each record's raw id to a human label (a reference number, name, email …) so a
    // non-technical reader sees "Submission NCA/SUB/2026/000123", not a bare UUID.
    const labels = await this.resolveTargets(rows);
    const data = rows.map((r) => ({
      ...r,
      target:
        r.entityType && r.entityId
          ? (labels.get(`${r.entityType}:${r.entityId}`) ?? fallbackLabel(r.metadata))
          : null,
    }));

    return paginate(data, total, query);
  }

  /**
   * Batch-resolve the referenced record of each audit row to a friendly label, grouped by type so
   * it's one query per entity type (not per row). Deleted targets are still resolved — the trail
   * must stay readable after the thing it refers to is gone.
   */
  private async resolveTargets(
    rows: { entityType: string | null; entityId: string | null }[],
  ): Promise<Map<string, string>> {
    const idsByType = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!r.entityType || !r.entityId) continue;
      (
        idsByType.get(r.entityType) ?? idsByType.set(r.entityType, new Set()).get(r.entityType)!
      ).add(r.entityId);
    }
    const labels = new Map<string, string>();
    const ids = (type: string) => Array.from(idsByType.get(type) ?? []);
    const put = (type: string, id: string, label: string) => labels.set(`${type}:${id}`, label);

    if (idsByType.has('User')) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: ids('User') } },
        select: { id: true, firstName: true, lastName: true, email: true },
      });
      for (const u of users) put('User', u.id, `${u.firstName} ${u.lastName}`.trim() || u.email);
    }
    if (idsByType.has('Entity')) {
      const entities = await this.prisma.entity.findMany({
        where: { id: { in: ids('Entity') } },
        select: { id: true, name: true },
      });
      for (const e of entities) put('Entity', e.id, e.name);
    }
    if (idsByType.has('Agent')) {
      const agents = await this.prisma.agent.findMany({
        where: { id: { in: ids('Agent') } },
        select: { id: true, name: true, agentReference: true },
      });
      for (const a of agents) put('Agent', a.id, `${a.name} (${a.agentReference})`);
    }
    if (idsByType.has('ReportingTemplate')) {
      const templates = await this.prisma.reportingTemplate.findMany({
        where: { id: { in: ids('ReportingTemplate') } },
        select: { id: true, name: true, version: true },
      });
      for (const t of templates) put('ReportingTemplate', t.id, `${t.name} (v${t.version})`);
    }
    if (idsByType.has('ReportingPeriod')) {
      const periods = await this.prisma.reportingPeriod.findMany({
        where: { id: { in: ids('ReportingPeriod') } },
        select: { id: true, label: true, template: { select: { name: true } } },
      });
      for (const p of periods) put('ReportingPeriod', p.id, `${p.template.name}: ${p.label}`);
    }
    if (idsByType.has('Submission')) {
      const subs = await this.prisma.submission.findMany({
        where: { id: { in: ids('Submission') } },
        select: {
          id: true,
          referenceNumber: true,
          entity: { select: { name: true } },
          period: { select: { label: true } },
        },
      });
      for (const s of subs) {
        put('Submission', s.id, s.referenceNumber ?? `${s.entity.name}: ${s.period.label} (draft)`);
      }
    }
    if (idsByType.has('ReferenceItem')) {
      const items = await this.prisma.referenceItem.findMany({
        where: { id: { in: ids('ReferenceItem') } },
        select: { id: true, label: true },
      });
      for (const i of items) put('ReferenceItem', i.id, i.label);
    }
    return labels;
  }
}

/** When the target record can't be resolved, fall back to a human field stored in the metadata. */
function fallbackLabel(metadata: Prisma.JsonValue | null | undefined): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const m = metadata as Record<string, unknown>;
  for (const k of ['referenceNumber', 'name', 'email', 'agentReference', 'label']) {
    if (typeof m[k] === 'string' && m[k]) return m[k] as string;
  }
  return null;
}
