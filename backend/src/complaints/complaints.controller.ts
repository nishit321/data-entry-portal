import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { ComplaintsService } from './complaints.service';
import {
  ComplaintQueryDto,
  FileComplaintDto,
  TrackComplaintDto,
  UpdateComplaintStatusDto,
} from './dto/complaint.dto';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { ClientContext } from '../common/decorators/client-context.decorator';
import { RequestContext } from '../common/utils/request-context.util';

/** Who works citizen complaints. Reading is wider than acting, so analysts can report on them. */
const HANDLERS = [Role.ADMIN, Role.SUPERVISOR] as const;
const READERS = [Role.ADMIN, Role.SUPERVISOR, Role.ANALYST] as const;

/**
 * Citizen complaint intake (Q4).
 *
 * The two public routes are the only unauthenticated write and read in the portal, so both are
 * rate-limited well below the global ceiling: filing to stop bulk spam, tracking to stop anyone
 * grinding through reference numbers looking for a code that matches.
 */
@Controller('complaints')
export class ComplaintsController {
  constructor(private readonly complaints: ComplaintsService) {}

  @Post()
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  file(@Body() dto: FileComplaintDto, @ClientContext() ctx: RequestContext) {
    return this.complaints.file(dto, ctx);
  }

  @Post('track')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  track(@Body() dto: TrackComplaintDto) {
    return this.complaints.track(dto);
  }

  @Get()
  @Roles(...READERS)
  list(@Query() query: ComplaintQueryDto) {
    return this.complaints.findAll(query);
  }

  @Get(':id')
  @Roles(...READERS)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.complaints.findOne(id);
  }

  @Patch(':id/status')
  @Roles(...HANDLERS)
  updateStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateComplaintStatusDto,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.complaints.updateStatus(user, id, dto, ctx);
  }
}
