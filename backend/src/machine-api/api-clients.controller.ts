import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ApiClientsService } from './api-clients.service';
import { CreateApiClientDto, UpdateApiClientDto } from './dto/api-client.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { ClientContext } from '../common/decorators/client-context.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import { AUTHORITY_ROLES } from '../common/utils/data-scope.util';

/**
 * Machine credentials (Q10, Phase 3).
 *
 * An operator admin manages their own; the Authority can see and manage every operator's. A plain
 * submitter cannot: issuing a credential is granting a second way into the operator's own filings,
 * and that is an administrator's decision.
 */
@Controller('api-clients')
export class ApiClientsController {
  constructor(private readonly clients: ApiClientsService) {}

  @Get()
  @Roles(Role.OPERATOR_ADMIN, ...AUTHORITY_ROLES)
  list(@CurrentUser() user: AuthUser) {
    return this.clients.findAll(user);
  }

  /** Issue a credential. The secret is in this response and nowhere else, ever again. */
  @Post()
  @Roles(Role.OPERATOR_ADMIN, Role.ADMIN)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateApiClientDto,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.clients.create(user, dto, ctx);
  }

  @Patch(':id')
  @Roles(Role.OPERATOR_ADMIN, Role.ADMIN)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateApiClientDto,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.clients.update(user, id, dto, ctx);
  }

  /** Replace the secret. The old one stops working immediately. */
  @Post(':id/rotate')
  @Roles(Role.OPERATOR_ADMIN, Role.ADMIN)
  rotate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.clients.rotateSecret(user, id, ctx);
  }

  /** Kill it for good. Revoked credentials are never restored; a new one is issued instead. */
  @Delete(':id')
  @Roles(Role.OPERATOR_ADMIN, Role.ADMIN)
  revoke(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.clients.revoke(user, id, ctx);
  }
}
