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
import { EntitiesService } from './entities.service';
import { CreateEntityDto } from './dto/create-entity.dto';
import { UpdateEntityDto } from './dto/update-entity.dto';
import { UpdateEntityStatusDto } from './dto/update-entity-status.dto';
import { EntityQueryDto } from './dto/entity-query.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClientContext } from '../common/decorators/client-context.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import { AUTHORITY_ROLES } from '../common/utils/data-scope.util';

/**
 * Regulated-entity registry. Reads are open to Authority-internal roles;
 * onboarding and edits are ADMIN-only. An operator reads its own entity via
 * GET /entities/me (scoped by the entityId on its account).
 */
@Controller('entities')
export class EntitiesController {
  constructor(private readonly entities: EntitiesService) {}

  @Get()
  @Roles(...AUTHORITY_ROLES)
  findAll(@Query() query: EntityQueryDto) {
    return this.entities.findAll(query);
  }

  // Declared before :id so "me" is not matched as an id.
  @Get('me')
  @Roles(Role.OPERATOR_ADMIN, Role.OPERATOR_SUBMITTER)
  findMine(@CurrentUser('entityId') entityId: string | null) {
    return this.entities.findMine(entityId);
  }

  @Get(':id')
  @Roles(...AUTHORITY_ROLES)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.entities.findOne(id);
  }

  @Post()
  @Roles(Role.ADMIN)
  create(
    @Body() dto: CreateEntityDto,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.entities.create(dto, actorId, ctx);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEntityDto,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.entities.update(id, dto, actorId, ctx);
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN)
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEntityStatusDto,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.entities.setStatus(id, dto.status, actorId, ctx);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.entities.remove(id, actorId, ctx);
  }
}
