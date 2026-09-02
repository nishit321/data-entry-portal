import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { FeedsService } from './feeds.service';
import { CreateAgreementDto, UpdateAgreementDto } from './dto/agreement.dto';
import { CreateFeedDto, UpdateFeedDto } from './dto/feed.dto';
import { FeedMetricQueryDto } from './dto/feed-metric-query.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { ClientContext } from '../common/decorators/client-context.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import { AUTHORITY_ROLES, OPERATOR_ROLES } from '../common/utils/data-scope.util';

/**
 * Data-sharing agreements and the feeds that run under them (Q10, Phase 3).
 *
 * An operator can see the agreements it has signed and the feeds running against its systems —
 * being able to see what a regulator is collecting from you is not a courtesy. Setting one up is
 * the Authority's job, because the agreement is the Authority's instrument.
 */
@Controller('feeds')
export class FeedsController {
  constructor(private readonly feeds: FeedsService) {}

  @Get('agreements')
  @Roles(...OPERATOR_ROLES, ...AUTHORITY_ROLES)
  listAgreements(@CurrentUser() user: AuthUser) {
    return this.feeds.listAgreements(user);
  }

  @Post('agreements')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  createAgreement(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateAgreementDto,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.feeds.createAgreement(dto, user.id, ctx);
  }

  @Patch('agreements/:id')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  updateAgreement(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAgreementDto,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.feeds.updateAgreement(id, dto, user.id, ctx);
  }

  @Delete('agreements/:id')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  removeAgreement(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.feeds.removeAgreement(id, user.id, ctx);
  }

  /** What the feeds have collected. Telemetry an operator agreed to share, not a filed return. */
  @Get('metrics')
  @Roles(...OPERATOR_ROLES, ...AUTHORITY_ROLES)
  metrics(@CurrentUser() user: AuthUser, @Query() query: FeedMetricQueryDto) {
    return this.feeds.metrics(user, query);
  }

  @Get()
  @Roles(...OPERATOR_ROLES, ...AUTHORITY_ROLES)
  listFeeds(@CurrentUser() user: AuthUser) {
    return this.feeds.listFeeds(user);
  }

  /** Recent attempts, so a feed that quietly stopped shows as a run of failures. */
  @Get(':id/runs')
  @Roles(...OPERATOR_ROLES, ...AUTHORITY_ROLES)
  runs(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.feeds.feedRuns(user, id);
  }

  @Post()
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  createFeed(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateFeedDto,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.feeds.createFeed(dto, user.id, ctx);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  updateFeed(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFeedDto,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.feeds.updateFeed(id, dto, user.id, ctx);
  }

  /** Pull it now rather than waiting for the timetable. */
  @Post(':id/run')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  run(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.feeds.runFeed(id, user.id, ctx);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  removeFeed(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.feeds.removeFeed(id, user.id, ctx);
  }
}
