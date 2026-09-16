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
import { GeoService } from './geo.service';
import { CreateNetworkSiteDto, UpdateNetworkSiteDto } from './dto/network-site.dto';
import { MapQueryDto, NetworkSiteQueryDto } from './dto/geo-query.dto';
import { CreateFibreLinkDto, FibreLinkQueryDto, UpdateFibreLinkDto } from './dto/fibre-link.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { ClientContext } from '../common/decorators/client-context.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import { AUTHORITY_ROLES, OPERATOR_ROLES } from '../common/utils/data-scope.util';

/**
 * The network map and the site register behind it (Phase 2).
 *
 * An operator keeps its own register; the Authority reads every operator's. Writing is an
 * operator's job, plus an administrator who may correct a record on their behalf, exactly as the
 * agent register already works.
 */
@Controller('geo')
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  /** Every point the reader may see, for drawing. */
  @Get('map')
  @Roles(...OPERATOR_ROLES, ...AUTHORITY_ROLES)
  map(@CurrentUser() user: AuthUser, @Query() query: MapQueryDto) {
    return this.geo.map(user, query);
  }

  @Get('sites')
  @Roles(...OPERATOR_ROLES, ...AUTHORITY_ROLES)
  list(@CurrentUser() user: AuthUser, @Query() query: NetworkSiteQueryDto) {
    return this.geo.findAll(user, query);
  }

  @Get('sites/:id')
  @Roles(...OPERATOR_ROLES, ...AUTHORITY_ROLES)
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.geo.findOne(user, id);
  }

  @Post('sites')
  @Roles(...OPERATOR_ROLES, Role.ADMIN)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateNetworkSiteDto,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.geo.create(user, dto, ctx);
  }

  @Patch('sites/:id')
  @Roles(...OPERATOR_ROLES, Role.ADMIN)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNetworkSiteDto,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.geo.update(user, id, dto, ctx);
  }

  @Delete('sites/:id')
  @Roles(...OPERATOR_ROLES, Role.ADMIN)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.geo.remove(user, id, ctx);
  }

  /*
   * Fibre routes (NCA, 15 September 2026).
   *
   * Scoped and written exactly as sites are, because they are part of the same register: an
   * operator keeps its own routes, the Authority reads the sector, and an administrator may
   * correct a record on an operator's behalf.
   */
  @Get('links')
  @Roles(...OPERATOR_ROLES, ...AUTHORITY_ROLES)
  listLinks(@CurrentUser() user: AuthUser, @Query() query: FibreLinkQueryDto) {
    return this.geo.findAllLinks(user, query);
  }

  @Post('links')
  @Roles(...OPERATOR_ROLES, Role.ADMIN)
  createLink(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateFibreLinkDto,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.geo.createLink(user, dto, ctx);
  }

  @Patch('links/:id')
  @Roles(...OPERATOR_ROLES, Role.ADMIN)
  updateLink(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFibreLinkDto,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.geo.updateLink(user, id, dto, ctx);
  }

  @Delete('links/:id')
  @Roles(...OPERATOR_ROLES, Role.ADMIN)
  removeLink(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.geo.removeLink(user, id, ctx);
  }
}
