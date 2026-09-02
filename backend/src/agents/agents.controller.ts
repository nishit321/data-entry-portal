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
import { AgentsService } from './agents.service';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';
import { AgentQueryDto } from './dto/agent-query.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { ClientContext } from '../common/decorators/client-context.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import { AUTHORITY_ROLES } from '../common/utils/data-scope.util';

/**
 * Agent network beneath an operator. Every action is scoped by data
 * segregation in the service: an operator only ever touches its own agents,
 * while Authority roles have cross-operator visibility. Writes are limited to
 * the operator's own admin and the Authority ADMIN.
 */
@Controller('agents')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get()
  @Roles(Role.OPERATOR_ADMIN, Role.OPERATOR_SUBMITTER, ...AUTHORITY_ROLES)
  findAll(@CurrentUser() user: AuthUser, @Query() query: AgentQueryDto) {
    return this.agents.findAll(user, query);
  }

  @Get(':id')
  @Roles(Role.OPERATOR_ADMIN, Role.OPERATOR_SUBMITTER, ...AUTHORITY_ROLES)
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.agents.findOne(user, id);
  }

  @Post()
  @Roles(Role.OPERATOR_ADMIN, Role.ADMIN)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateAgentDto,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.agents.create(user, dto, ctx);
  }

  @Patch(':id')
  @Roles(Role.OPERATOR_ADMIN, Role.ADMIN)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAgentDto,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.agents.update(user, id, dto, ctx);
  }

  @Delete(':id')
  @Roles(Role.OPERATOR_ADMIN, Role.ADMIN)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.agents.remove(user, id, ctx);
  }
}
