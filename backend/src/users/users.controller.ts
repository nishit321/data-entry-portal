import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { UsersService } from './users.service';
import { TotpService } from '../auth/totp.service';
import { CreateUserDto, UpdateUserDto, UpdateRoleDto } from './dto/user.dto';
import { UserQueryDto } from './dto/user-query.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClientContext } from '../common/decorators/client-context.decorator';
import { RequestContext } from '../common/utils/request-context.util';

/**
 * User administration. The global JwtAuthGuard authenticates every request;
 * @Roles(ADMIN) restricts the whole controller to administrators.
 */
@Controller('users')
@Roles(Role.ADMIN)
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly totp: TotpService,
  ) {}

  @Get('roles')
  listRoles() {
    return this.users.listRoles();
  }

  @Get()
  findAll(@Query() query: UserQueryDto) {
    return this.users.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.findOne(id);
  }

  @Post()
  create(
    @Body() dto: CreateUserDto,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.users.create(dto, actorId, ctx);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.users.update(id, dto, actorId, ctx);
  }

  @Patch(':id/role')
  setRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.users.setRole(id, dto.role, actorId, ctx);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.users.remove(id, actorId, ctx);
  }

  /**
   * Remove another user's authenticator app, for when the phone and the recovery codes are both
   * gone.
   *
   * Administrators only (the whole controller is), never on yourself, always audited, and the
   * account holder is told. The reasoning is with the service; the short version is that this is
   * also the shape of an account takeover, so it leaves a trail and it tells the victim.
   */
  @Post(':id/reset-mfa')
  @HttpCode(HttpStatus.OK)
  resetMfa(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.totp.resetFor(id, actorId, ctx);
  }
}
