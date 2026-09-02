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
import { LevyService } from './levy.service';
import { CreateLevyRateDto, UpdateLevyRateDto } from './dto/levy-rate.dto';
import { LevyAssessmentQueryDto } from './dto/levy-query.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { ClientContext } from '../common/decorators/client-context.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import { AUTHORITY_ROLES, OPERATOR_ROLES } from '../common/utils/data-scope.util';

/** Regulatory levy: rate configuration (ADMIN) and revenue-based assessments (scoped). */
@Controller('levy')
export class LevyController {
  constructor(private readonly levy: LevyService) {}

  @Get('rates')
  @Roles(...AUTHORITY_ROLES)
  listRates() {
    return this.levy.listRates();
  }

  @Post('rates')
  @Roles(Role.ADMIN)
  createRate(
    @Body() dto: CreateLevyRateDto,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.levy.createRate(dto, actorId, ctx);
  }

  @Patch('rates/:id')
  @Roles(Role.ADMIN)
  updateRate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLevyRateDto,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.levy.updateRate(id, dto, actorId, ctx);
  }

  @Delete('rates/:id')
  @Roles(Role.ADMIN)
  removeRate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.levy.removeRate(id, actorId, ctx);
  }

  @Get('assessments')
  @Roles(...OPERATOR_ROLES, ...AUTHORITY_ROLES)
  assessments(@CurrentUser() user: AuthUser, @Query() query: LevyAssessmentQueryDto) {
    return this.levy.assessments(user, query);
  }
}
