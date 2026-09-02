import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ReportsService } from './reports.service';
import { CreateReportScheduleDto, UpdateReportScheduleDto } from './dto/report-schedule.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { ClientContext } from '../common/decorators/client-context.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import { AUTHORITY_ROLES } from '../common/utils/data-scope.util';

/**
 * Reports the portal builds and sends on a timetable (Phase 2).
 *
 * Authority-only throughout, including reads: a scheduled report carries sector figures, and the
 * distribution list is itself a list of who sees them.
 */
@Controller('report-schedules')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @Roles(...AUTHORITY_ROLES)
  list() {
    return this.reports.list();
  }

  @Post()
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateReportScheduleDto,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.reports.create(dto, user.id, ctx);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReportScheduleDto,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.reports.update(id, dto, user.id, ctx);
  }

  /** Send it now rather than waiting for the timetable. */
  @Post(':id/send')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  send(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.reports.sendNow(id, user.id, ctx);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.reports.remove(id, user.id, ctx);
  }
}
