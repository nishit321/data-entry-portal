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
import { ReportingPeriodsService } from './reporting-periods.service';
import { CreatePeriodDto, PeriodQueryDto, UpdatePeriodDto } from './dto/period.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClientContext } from '../common/decorators/client-context.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import { AUTHORITY_ROLES, OPERATOR_ROLES } from '../common/utils/data-scope.util';

/**
 * Reporting periods the Authority runs against published templates. Periods are global, not
 * entity-scoped, so reads are open to operators and Authority staff alike: an operator has to see
 * the open periods to file against them. They are not open to *any* authenticated account, though
 * — the filing calendar is internal scheduling, and a self-registered CITIZEN has no business with
 * it. Opening, closing, and editing stay ADMIN-only.
 */
@Controller('reporting-periods')
export class ReportingPeriodsController {
  constructor(private readonly periods: ReportingPeriodsService) {}

  @Get()
  @Roles(...OPERATOR_ROLES, ...AUTHORITY_ROLES)
  findAll(@Query() query: PeriodQueryDto) {
    return this.periods.findAll(query);
  }

  @Get(':id')
  @Roles(...OPERATOR_ROLES, ...AUTHORITY_ROLES)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.periods.findOne(id);
  }

  @Post()
  @Roles(Role.ADMIN)
  create(
    @Body() dto: CreatePeriodDto,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.periods.create(dto, actorId, ctx);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePeriodDto,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.periods.update(id, dto, actorId, ctx);
  }

  @Post(':id/open')
  @Roles(Role.ADMIN)
  open(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.periods.open(id, actorId, ctx);
  }

  @Post(':id/close')
  @Roles(Role.ADMIN)
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.periods.close(id, actorId, ctx);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.periods.remove(id, actorId, ctx);
  }
}
