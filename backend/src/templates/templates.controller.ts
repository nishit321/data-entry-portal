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
import { TemplatesService } from './templates.service';
import { CreateTemplateDto, TemplateQueryDto, UpdateTemplateDto } from './dto/template.dto';
import { CreateSectionDto, UpdateSectionDto } from './dto/section.dto';
import { CreateFieldDto, UpdateFieldDto } from './dto/field.dto';
import { CreateRuleDto, UpdateRuleDto } from './dto/rule.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClientContext } from '../common/decorators/client-context.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import { AUTHORITY_ROLES } from '../common/utils/data-scope.util';

/**
 * Questionnaire template administration. Reads are open to Authority-internal
 * roles; all edits are ADMIN-only. A published template is immutable — changing
 * it means POST /:id/new-version (a fresh draft clone). Templates are global
 * (not entity-scoped).
 */
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  @Roles(...AUTHORITY_ROLES)
  findAll(@Query() query: TemplateQueryDto) {
    return this.templates.findAll(query);
  }

  @Get(':id')
  @Roles(...AUTHORITY_ROLES)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.findOne(id);
  }

  @Post()
  @Roles(Role.ADMIN)
  create(
    @Body() dto: CreateTemplateDto,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.templates.create(dto, actorId, ctx);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTemplateDto,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.templates.update(id, dto, actorId, ctx);
  }

  @Post(':id/publish')
  @Roles(Role.ADMIN)
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.templates.publish(id, actorId, ctx);
  }

  @Post(':id/new-version')
  @Roles(Role.ADMIN)
  newVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.templates.newVersion(id, actorId, ctx);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.templates.remove(id, actorId, ctx);
  }

  // --- Sections ---------------------------------------------------------------

  @Post(':id/sections')
  @Roles(Role.ADMIN)
  addSection(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSectionDto,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.templates.addSection(id, dto, actorId, ctx);
  }

  @Patch(':id/sections/:sectionId')
  @Roles(Role.ADMIN)
  updateSection(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Body() dto: UpdateSectionDto,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.templates.updateSection(id, sectionId, dto, actorId, ctx);
  }

  @Delete(':id/sections/:sectionId')
  @Roles(Role.ADMIN)
  removeSection(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.templates.removeSection(id, sectionId, actorId, ctx);
  }

  // --- Fields -----------------------------------------------------------------

  @Post(':id/sections/:sectionId/fields')
  @Roles(Role.ADMIN)
  addField(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Body() dto: CreateFieldDto,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.templates.addField(id, sectionId, dto, actorId, ctx);
  }

  @Patch(':id/sections/:sectionId/fields/:fieldId')
  @Roles(Role.ADMIN)
  updateField(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @Body() dto: UpdateFieldDto,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.templates.updateField(id, sectionId, fieldId, dto, actorId, ctx);
  }

  @Delete(':id/sections/:sectionId/fields/:fieldId')
  @Roles(Role.ADMIN)
  removeField(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.templates.removeField(id, sectionId, fieldId, actorId, ctx);
  }

  // --- Cross-field rules ------------------------------------------------------

  @Post(':id/rules')
  @Roles(Role.ADMIN)
  addRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRuleDto,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.templates.addRule(id, dto, actorId, ctx);
  }

  @Patch(':id/rules/:ruleId')
  @Roles(Role.ADMIN)
  updateRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Body() dto: UpdateRuleDto,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.templates.updateRule(id, ruleId, dto, actorId, ctx);
  }

  @Delete(':id/rules/:ruleId')
  @Roles(Role.ADMIN)
  removeRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.templates.removeRule(id, ruleId, actorId, ctx);
  }
}
