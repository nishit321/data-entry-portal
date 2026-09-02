import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { EnforcementService } from './enforcement.service';
import { EnforcementQueryDto } from './dto/enforcement-query.dto';
import { ResolveCaseDto } from './dto/resolve-case.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { ClientContext } from '../common/decorators/client-context.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import { AUTHORITY_ROLES, OPERATOR_ROLES } from '../common/utils/data-scope.util';

/** Case management is a management action; opening happens automatically via the sweep. */
const CASE_MANAGERS = [Role.ADMIN, Role.SUPERVISOR] as const;

/** Compliance / enforcement cases (Q3). Reads are scoped; management is Authority-only. */
@Controller('enforcement')
export class EnforcementController {
  constructor(private readonly enforcement: EnforcementService) {}

  @Get()
  @Roles(...OPERATOR_ROLES, ...AUTHORITY_ROLES)
  list(@CurrentUser() user: AuthUser, @Query() query: EnforcementQueryDto) {
    return this.enforcement.findAll(user, query);
  }

  @Post('sweep')
  @Roles(...CASE_MANAGERS)
  sweep(@CurrentUser() user: AuthUser, @ClientContext() ctx: RequestContext) {
    return this.enforcement.sweepDue(user.id, ctx);
  }

  /**
   * Bring open cases up to date by hand.
   *
   * The nightly job does this on its own; the endpoint is for the day an administrator enters a
   * schedule for the first time and wants the cases already open to be priced now rather than in
   * the morning.
   */
  @Post('accrue')
  @Roles(...CASE_MANAGERS)
  accrue(@CurrentUser() user: AuthUser, @ClientContext() ctx: RequestContext) {
    return this.enforcement.accrue(user.id, ctx);
  }

  @Patch(':id/resolve')
  @Roles(...CASE_MANAGERS)
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveCaseDto,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.enforcement.resolve(user, id, dto, ctx);
  }

  @Patch(':id/waive')
  @Roles(...CASE_MANAGERS)
  waive(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveCaseDto,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.enforcement.waive(user, id, dto, ctx);
  }
}
