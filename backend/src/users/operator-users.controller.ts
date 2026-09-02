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
import { OperatorCreateUserDto, OperatorUpdateUserDto } from './dto/operator-user.dto';
import { UserQueryDto } from './dto/user-query.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClientContext } from '../common/decorators/client-context.decorator';
import { RequestContext } from '../common/utils/request-context.util';

/**
 * Operator self-service user administration. Restricted to OPERATOR_ADMIN, and
 * every action is scoped to the caller's own entity (the entityId comes from
 * the token, never the request body). Only operator roles can be assigned.
 */
@Controller('operator/users')
@Roles(Role.OPERATOR_ADMIN)
export class OperatorUsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  findAll(@CurrentUser('entityId') entityId: string | null, @Query() query: UserQueryDto) {
    return this.users.listForEntity(entityId, query);
  }

  @Get(':id')
  findOne(
    @CurrentUser('entityId') entityId: string | null,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.users.findOneInEntity(entityId, id);
  }

  @Post()
  create(
    @CurrentUser('entityId') entityId: string | null,
    @CurrentUser('id') actorId: string,
    @Body() dto: OperatorCreateUserDto,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.users.createForEntity(entityId, dto, actorId, ctx);
  }

  @Patch(':id')
  update(
    @CurrentUser('entityId') entityId: string | null,
    @CurrentUser('id') actorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OperatorUpdateUserDto,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.users.updateInEntity(entityId, id, dto, actorId, ctx);
  }

  @Delete(':id')
  remove(
    @CurrentUser('entityId') entityId: string | null,
    @CurrentUser('id') actorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.users.removeFromEntity(entityId, id, actorId, ctx);
  }
}
