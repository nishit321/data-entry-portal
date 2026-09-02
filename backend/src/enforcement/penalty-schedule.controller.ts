import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PenaltyScheduleService } from './penalty-schedule.service';
import { CreatePenaltyRuleDto, UpdatePenaltyRuleDto } from './dto/penalty-rule.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { ClientContext } from '../common/decorators/client-context.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import { AUTHORITY_ROLES, OPERATOR_ROLES } from '../common/utils/data-scope.util';

/**
 * NCA Legal & Licensing's penalty schedule (Q3).
 *
 * Reading it is open to operators as well as the Authority: an operator being charged under a
 * schedule is entitled to see the schedule. Editing it is an administrator's job.
 */
@Controller('penalty-schedule')
export class PenaltyScheduleController {
  constructor(private readonly schedule: PenaltyScheduleService) {}

  @Get()
  @Roles(...OPERATOR_ROLES, ...AUTHORITY_ROLES)
  list() {
    return this.schedule.list();
  }

  @Post()
  @Roles(Role.ADMIN)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePenaltyRuleDto,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.schedule.create(dto, user.id, ctx);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePenaltyRuleDto,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.schedule.update(id, dto, user.id, ctx);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.schedule.remove(id, user.id, ctx);
  }
}
