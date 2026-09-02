import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AgreementStatus, AuditAction, FeedRunOutcome, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import { entityScopeFilter } from '../common/utils/data-scope.util';
import { FeedFetcher } from './feed-fetcher';
import { checkFeedUrl } from './feed-url';
import { agreementInForce, isFeedDue } from './feed-schedule';
import { CreateAgreementDto, UpdateAgreementDto } from './dto/agreement.dto';
import { CreateFeedDto, UpdateFeedDto } from './dto/feed.dto';
import { FeedMetricQueryDto } from './dto/feed-metric-query.dto';

/** How many metric rows one run may store. A feed is telemetry, not a bulk load. */
const MAX_METRICS_PER_RUN = 10_000;

const agreementSelect = {
  id: true,
  reference: true,
  title: true,
  scope: true,
  status: true,
  signedAt: true,
  startsAt: true,
  endsAt: true,
  createdAt: true,
  entity: { select: { id: true, name: true, type: true } },
  // Live feeds only. Counting removed ones would show an agreement as busier than it is, and
  // would leave it permanently undeletable once its feeds had been tidied away.
  _count: { select: { feeds: { where: { deletedAt: null } } } },
} satisfies Prisma.DataSharingAgreementSelect;

/**
 * The access token is never in a read.
 *
 * It is a secret the operator issued to NCA, and a screen that displays it turns every person with
 * a login into someone who could use it elsewhere. It is written and never read back.
 */
const feedSelect = {
  id: true,
  name: true,
  url: true,
  frequency: true,
  hour: true,
  dayOfWeek: true,
  isEnabled: true,
  lastRunAt: true,
  lastOutcome: true,
  lastError: true,
  createdAt: true,
  agreement: {
    select: {
      id: true,
      reference: true,
      title: true,
      status: true,
      startsAt: true,
      endsAt: true,
      entity: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.NetworkFeedSelect;

/**
 * Automated metric feeds under data-sharing agreements (Q10, Phase 3).
 *
 * Two rules shape everything here:
 *
 * - **No agreement, no feed.** Checked on every pull, not when the feed was configured. An
 *   agreement that lapses on Friday stops the data on Friday, which is what "governed by a formal
 *   agreement" has to mean if it means anything.
 * - **A feed is telemetry, not a return.** Metrics land in their own table and never enter the
 *   submission workflow. An operator signs a return; it does not sign a number its monitoring
 *   system emitted at three in the morning, and treating the two alike would put an unsigned
 *   figure into a regulatory filing.
 */
@Injectable()
export class FeedsService {
  private readonly logger = new Logger(FeedsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fetcher: FeedFetcher,
  ) {}

  // --- Agreements -----------------------------------------------------------

  listAgreements(user: AuthUser) {
    const scoped = entityScopeFilter(user);
    return this.prisma.dataSharingAgreement.findMany({
      where: { deletedAt: null, entityId: scoped },
      orderBy: [{ startsAt: 'desc' }],
      select: agreementSelect,
    });
  }

  async createAgreement(dto: CreateAgreementDto, actorId: string, ctx: RequestContext) {
    const { startsAt, endsAt } = this.parseWindow(dto.startsAt, dto.endsAt);
    const clash = await this.prisma.dataSharingAgreement.findFirst({
      where: { reference: dto.reference.trim(), deletedAt: null },
      select: { id: true },
    });
    if (clash) throw new BadRequestException('An agreement with that reference already exists.');

    const agreement = await this.prisma.dataSharingAgreement.create({
      data: {
        entityId: dto.entityId,
        reference: dto.reference.trim(),
        title: dto.title.trim(),
        scope: dto.scope?.trim() || null,
        status: dto.status ?? AgreementStatus.DRAFT,
        signedAt: dto.signedAt ? new Date(dto.signedAt) : null,
        startsAt,
        endsAt,
        createdById: actorId,
      },
      select: agreementSelect,
    });
    await this.record(
      AuditAction.AGREEMENT_CREATED,
      'DataSharingAgreement',
      agreement.id,
      actorId,
      ctx,
      {
        reference: agreement.reference,
        status: agreement.status,
      },
    );
    return agreement;
  }

  async updateAgreement(id: string, dto: UpdateAgreementDto, actorId: string, ctx: RequestContext) {
    const existing = await this.prisma.dataSharingAgreement.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, startsAt: true, endsAt: true },
    });
    if (!existing) throw new NotFoundException('That agreement does not exist.');

    const { startsAt, endsAt } = this.parseWindow(
      dto.startsAt ?? existing.startsAt.toISOString(),
      dto.endsAt === undefined ? (existing.endsAt?.toISOString() ?? undefined) : dto.endsAt,
    );

    const agreement = await this.prisma.dataSharingAgreement.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        scope: dto.scope === undefined ? undefined : dto.scope.trim() || null,
        status: dto.status,
        signedAt: dto.signedAt === undefined ? undefined : new Date(dto.signedAt),
        startsAt: dto.startsAt ? startsAt : undefined,
        endsAt: dto.endsAt === undefined ? undefined : endsAt,
      },
      select: agreementSelect,
    });
    await this.record(AuditAction.AGREEMENT_UPDATED, 'DataSharingAgreement', id, actorId, ctx, {
      changes: { ...dto },
    });
    return agreement;
  }

  async removeAgreement(id: string, actorId: string, ctx: RequestContext) {
    const existing = await this.prisma.dataSharingAgreement.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, _count: { select: { feeds: { where: { deletedAt: null } } } } },
    });
    if (!existing) throw new NotFoundException('That agreement does not exist.');
    if (existing._count.feeds > 0) {
      throw new BadRequestException(
        'Feeds are still running under this agreement. Remove them first, or mark the agreement terminated.',
      );
    }
    await this.prisma.dataSharingAgreement.update({
      where: { id },
      data: { deletedAt: new Date(), status: AgreementStatus.TERMINATED },
    });
    await this.record(AuditAction.AGREEMENT_DELETED, 'DataSharingAgreement', id, actorId, ctx);
    return { message: 'Agreement removed' };
  }

  // --- Feeds ----------------------------------------------------------------

  listFeeds(user: AuthUser) {
    const scoped = entityScopeFilter(user);
    return this.prisma.networkFeed.findMany({
      where: { deletedAt: null, agreement: { entityId: scoped, deletedAt: null } },
      orderBy: [{ name: 'asc' }],
      select: feedSelect,
    });
  }

  /** Recent attempts at one feed, so a silent feed is visible as a run of failures. */
  async feedRuns(user: AuthUser, feedId: string) {
    const scoped = entityScopeFilter(user);
    const feed = await this.prisma.networkFeed.findFirst({
      where: { id: feedId, deletedAt: null, agreement: { entityId: scoped } },
      select: { id: true },
    });
    if (!feed) throw new NotFoundException('That feed does not exist.');

    const runs = await this.prisma.feedRun.findMany({
      where: { feedId },
      orderBy: { startedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        outcome: true,
        startedAt: true,
        finishedAt: true,
        metricCount: true,
        httpStatus: true,
        message: true,
      },
    });
    return { runs };
  }

  async createFeed(dto: CreateFeedDto, actorId: string, ctx: RequestContext) {
    const agreement = await this.prisma.dataSharingAgreement.findFirst({
      where: { id: dto.agreementId, deletedAt: null },
      select: { id: true },
    });
    if (!agreement) throw new NotFoundException('That agreement does not exist.');

    const checked = checkFeedUrl(dto.url.trim());
    if (!checked.ok) throw new BadRequestException(checked.reason);
    this.assertDay(dto.dayOfWeek);

    const feed = await this.prisma.networkFeed.create({
      data: {
        agreementId: dto.agreementId,
        name: dto.name.trim(),
        url: dto.url.trim(),
        frequency: dto.frequency,
        hour: dto.hour ?? 3,
        dayOfWeek: dto.dayOfWeek ?? 1,
        isEnabled: dto.isEnabled ?? true,
        authToken: dto.authToken?.trim() || null,
        createdById: actorId,
      },
      select: feedSelect,
    });
    await this.record(AuditAction.FEED_CREATED, 'NetworkFeed', feed.id, actorId, ctx, {
      agreementId: dto.agreementId,
      host: checked.url!.hostname,
    });
    return feed;
  }

  async updateFeed(id: string, dto: UpdateFeedDto, actorId: string, ctx: RequestContext) {
    const existing = await this.prisma.networkFeed.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('That feed does not exist.');

    if (dto.url !== undefined) {
      const checked = checkFeedUrl(dto.url.trim());
      if (!checked.ok) throw new BadRequestException(checked.reason);
    }
    this.assertDay(dto.dayOfWeek);

    const feed = await this.prisma.networkFeed.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        url: dto.url?.trim(),
        frequency: dto.frequency,
        hour: dto.hour,
        dayOfWeek: dto.dayOfWeek,
        isEnabled: dto.isEnabled,
        // An empty string clears the token; undefined leaves it alone.
        authToken: dto.authToken === undefined ? undefined : dto.authToken.trim() || null,
      },
      select: feedSelect,
    });
    await this.record(AuditAction.FEED_UPDATED, 'NetworkFeed', id, actorId, ctx, {
      changes: { ...dto, authToken: dto.authToken === undefined ? undefined : '[changed]' },
    });
    return feed;
  }

  async removeFeed(id: string, actorId: string, ctx: RequestContext) {
    const existing = await this.prisma.networkFeed.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('That feed does not exist.');
    await this.prisma.networkFeed.update({
      where: { id },
      data: { deletedAt: new Date(), isEnabled: false },
    });
    await this.record(AuditAction.FEED_DELETED, 'NetworkFeed', id, actorId, ctx);
    return { message: 'Feed removed' };
  }

  /**
   * What the feeds have actually collected.
   *
   * Without this the portal would be gathering telemetry nobody could look at, which is the
   * failure mode where a feature is "built" and useless. Scoped like everything else: an operator
   * sees the metrics collected from its own systems, the Authority sees the sector.
   *
   * These are figures an operator agreed to share, not figures it filed and signed. Nothing here
   * feeds the submission workflow, and the screen says so.
   */
  async metrics(user: AuthUser, query: FeedMetricQueryDto) {
    const scoped = entityScopeFilter(user);
    const entityId = scoped ?? query.entityId;

    const where: Prisma.FeedMetricWhereInput = {
      entityId,
      key: query.key,
      ...(query.from || query.to
        ? {
            measuredAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const [rows, keys] = await Promise.all([
      this.prisma.feedMetric.findMany({
        where,
        orderBy: { measuredAt: 'desc' },
        take: query.limit ?? 500,
        select: {
          id: true,
          key: true,
          value: true,
          unit: true,
          measuredAt: true,
          entity: { select: { id: true, name: true } },
          feedRun: { select: { id: true, feed: { select: { id: true, name: true } } } },
        },
      }),
      // The names actually present, so a reader can pick one rather than guess it.
      this.prisma.feedMetric.groupBy({
        by: ['key'],
        where: { entityId },
        _count: true,
        orderBy: { key: 'asc' },
      }),
    ]);

    return {
      metrics: rows,
      keys: keys.map((k) => ({ key: k.key, count: k._count })),
    };
  }

  // --- Running --------------------------------------------------------------

  /** Pull one feed now, whatever its timetable says. Used by the "run now" button. */
  async runFeed(id: string, actorId: string | null, ctx: RequestContext) {
    const feed = await this.loadRunnable(id);
    return this.run(feed, actorId, ctx);
  }

  /**
   * Pull every feed whose window has come round. Run hourly by the scheduler.
   *
   * One feed failing must not stop the others: an operator whose endpoint is down should cost its
   * own feed a failed run, not cost every other operator theirs.
   */
  async runDue(actorId: string | null, ctx: RequestContext) {
    const feeds = await this.prisma.networkFeed.findMany({
      where: { deletedAt: null, isEnabled: true, agreement: { deletedAt: null } },
      select: this.runnableSelect,
    });

    const now = new Date();
    let ran = 0;
    let failed = 0;
    let skipped = 0;

    for (const feed of feeds) {
      if (!isFeedDue(now, feed, feed.lastRunAt)) continue;
      try {
        const result = await this.run(feed, actorId, ctx);
        if (result.outcome === FeedRunOutcome.SUCCEEDED) ran += 1;
        else if (result.outcome === FeedRunOutcome.SKIPPED) skipped += 1;
        else failed += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(`Feed "${feed.name}" could not be run`, error as Error);
      }
    }

    return { considered: feeds.length, ran, failed, skipped };
  }

  private readonly runnableSelect = {
    id: true,
    name: true,
    url: true,
    frequency: true,
    hour: true,
    dayOfWeek: true,
    lastRunAt: true,
    authToken: true,
    agreement: {
      select: {
        id: true,
        entityId: true,
        reference: true,
        status: true,
        startsAt: true,
        endsAt: true,
      },
    },
  } satisfies Prisma.NetworkFeedSelect;

  private async loadRunnable(id: string) {
    const feed = await this.prisma.networkFeed.findFirst({
      where: { id, deletedAt: null },
      select: this.runnableSelect,
    });
    if (!feed) throw new NotFoundException('That feed does not exist.');
    return feed;
  }

  /**
   * One attempt at one feed, recorded whether it worked or not.
   *
   * The run row is created before the request goes out, so a process that dies mid-fetch leaves a
   * record that something was attempted rather than no trace at all.
   */
  private async run(
    feed: Prisma.NetworkFeedGetPayload<{ select: FeedsService['runnableSelect'] }>,
    actorId: string | null,
    ctx: RequestContext,
  ) {
    const now = new Date();

    // The agreement is checked here, on the pull, and not when the feed was set up.
    if (!agreementInForce(feed.agreement, now)) {
      const run = await this.prisma.feedRun.create({
        data: {
          feedId: feed.id,
          outcome: FeedRunOutcome.SKIPPED,
          finishedAt: new Date(),
          message: `The data-sharing agreement ${feed.agreement.reference} is not in force.`,
        },
        select: { id: true, outcome: true, message: true, metricCount: true },
      });
      await this.stamp(feed.id, FeedRunOutcome.SKIPPED, run.message);
      await this.record(AuditAction.FEED_RUN, 'NetworkFeed', feed.id, actorId, ctx, {
        outcome: FeedRunOutcome.SKIPPED,
      });
      return run;
    }

    const started = await this.prisma.feedRun.create({
      data: { feedId: feed.id, outcome: FeedRunOutcome.FAILED, startedAt: now },
      select: { id: true },
    });

    const result = await this.fetcher.fetch(feed.url, feed.authToken);

    if (!result.ok) {
      const run = await this.prisma.feedRun.update({
        where: { id: started.id },
        data: {
          outcome: FeedRunOutcome.FAILED,
          finishedAt: new Date(),
          httpStatus: result.httpStatus,
          message: result.message?.slice(0, 500),
        },
        select: { id: true, outcome: true, message: true, metricCount: true },
      });
      await this.stamp(feed.id, FeedRunOutcome.FAILED, result.message);
      await this.record(AuditAction.FEED_RUN, 'NetworkFeed', feed.id, actorId, ctx, {
        outcome: FeedRunOutcome.FAILED,
        message: result.message,
      });
      return run;
    }

    const metrics = result.metrics.slice(0, MAX_METRICS_PER_RUN);
    if (metrics.length > 0) {
      await this.prisma.feedMetric.createMany({
        data: metrics.map((m) => ({
          feedRunId: started.id,
          entityId: feed.agreement.entityId,
          key: m.key,
          value: new Prisma.Decimal(m.value),
          unit: m.unit ?? null,
          measuredAt: new Date(m.measuredAt),
        })),
      });
    }

    const run = await this.prisma.feedRun.update({
      where: { id: started.id },
      data: {
        outcome: FeedRunOutcome.SUCCEEDED,
        finishedAt: new Date(),
        httpStatus: result.httpStatus,
        metricCount: metrics.length,
        message:
          result.metrics.length > metrics.length
            ? `Kept the first ${metrics.length} of ${result.metrics.length} metrics.`
            : null,
      },
      select: { id: true, outcome: true, message: true, metricCount: true },
    });
    await this.stamp(feed.id, FeedRunOutcome.SUCCEEDED, null);
    await this.record(AuditAction.FEED_RUN, 'NetworkFeed', feed.id, actorId, ctx, {
      outcome: FeedRunOutcome.SUCCEEDED,
      metrics: metrics.length,
    });
    return run;
  }

  /**
   * Stamp the feed with how it went.
   *
   * `lastRunAt` moves on a skip as well as on a success, so a feed whose agreement has lapsed does
   * not re-attempt every hour and fill the run log with the same message.
   */
  private stamp(feedId: string, outcome: FeedRunOutcome, error: string | null | undefined) {
    return this.prisma.networkFeed.update({
      where: { id: feedId },
      data: {
        lastRunAt: new Date(),
        lastOutcome: outcome,
        lastError: outcome === FeedRunOutcome.SUCCEEDED ? null : (error?.slice(0, 500) ?? null),
      },
    });
  }

  private parseWindow(startsAtRaw: string, endsAtRaw?: string) {
    const startsAt = new Date(startsAtRaw);
    if (Number.isNaN(startsAt.getTime())) throw new BadRequestException('Enter a start date.');
    const endsAt = endsAtRaw ? new Date(endsAtRaw) : null;
    if (endsAt && Number.isNaN(endsAt.getTime()))
      throw new BadRequestException('Enter an end date.');
    if (endsAt && endsAt <= startsAt) {
      throw new BadRequestException('The end date must be after the start date.');
    }
    return { startsAt, endsAt };
  }

  private assertDay(day: number | undefined) {
    if (day !== undefined && (day < 1 || day > 7)) {
      throw new BadRequestException('Choose a day of the week.');
    }
  }

  private record(
    action: AuditAction,
    entityType: string,
    id: string,
    actorId: string | null,
    ctx: RequestContext,
    metadata?: Record<string, unknown>,
  ) {
    return this.audit.record({
      action,
      actorId,
      entityType,
      entityId: id,
      metadata: metadata as Prisma.InputJsonValue,
      context: ctx,
    });
  }
}
