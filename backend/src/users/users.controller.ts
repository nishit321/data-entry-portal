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
import { UsersService } from './users.service';
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
  constructor(private readonly users: UsersService) {}

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
}
