import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ReferenceCategory, Role } from '@prisma/client';
import { ReferenceDataService } from './reference-data.service';
import { CreateReferenceItemDto } from './dto/create-reference-item.dto';
import { UpdateReferenceItemDto } from './dto/update-reference-item.dto';
import { ReferenceQueryDto } from './dto/reference-query.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClientContext } from '../common/decorators/client-context.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import { AUTHORITY_ROLES } from '../common/utils/data-scope.util';

/**
 * Managed lookup lists. The form-facing reads (`categories`, `lookup/:category`) are open to any
 * authenticated user because operators need them to fill in questionnaire controls; the management
 * listing (`findAll`/`findOne`, which includes inactive items) is Authority-only; writes are
 * ADMIN-only. Reference data is global (not entity-scoped), so no data-segregation applies.
 */
@Controller('reference-data')
export class ReferenceDataController {
  constructor(private readonly reference: ReferenceDataService) {}

  @Get('categories')
  listCategories() {
    return this.reference.listCategories();
  }

  // Form-facing lookup: the full active list for one category.
  @Get('lookup/:category')
  lookup(@Param('category', new ParseEnumPipe(ReferenceCategory)) category: ReferenceCategory) {
    return this.reference.lookup(category);
  }

  @Get()
  @Roles(...AUTHORITY_ROLES)
  findAll(@Query() query: ReferenceQueryDto) {
    return this.reference.findAll(query);
  }

  @Get(':id')
  @Roles(...AUTHORITY_ROLES)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.reference.findOne(id);
  }

  @Post()
  @Roles(Role.ADMIN)
  create(
    @Body() dto: CreateReferenceItemDto,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.reference.create(dto, actorId, ctx);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReferenceItemDto,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.reference.update(id, dto, actorId, ctx);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.reference.remove(id, actorId, ctx);
  }
}
