import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PublicIndicatorsService } from './public-indicators.service';
import { CreatePublicIndicatorDto, UpdatePublicIndicatorDto } from './dto/public-indicator.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { ClientContext } from '../common/decorators/client-context.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import { AUTHORITY_ROLES } from '../common/utils/data-scope.util';

/**
 * Deciding what the public sees (Q4).
 *
 * The Authority can read the list — knowing what is published is part of knowing what the portal
 * is doing — but only an administrator can change it.
 */
@Controller('public-indicators')
export class PublicIndicatorsController {
  constructor(private readonly indicators: PublicIndicatorsService) {}

  @Get()
  @Roles(...AUTHORITY_ROLES)
  list() {
    return this.indicators.list();
  }

  /** Questions eligible to be published, so an administrator picks rather than types a key. */
  @Get('available')
  @Roles(...AUTHORITY_ROLES)
  available() {
    return this.indicators.available();
  }

  @Post()
  @Roles(Role.ADMIN)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePublicIndicatorDto,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.indicators.create(dto, user.id, ctx);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePublicIndicatorDto,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.indicators.update(id, dto, user.id, ctx);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.indicators.remove(id, user.id, ctx);
  }
}
