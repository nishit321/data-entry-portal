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
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { ComplaintsService } from './complaints.service';
import { UploadedFile as UploadedFileType } from '../files/storage.service';
import {
  AttachComplaintFileDto,
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
 * A hard stop on the multipart parser, above the service's own limit so an ordinary oversized file
 * meets the readable message rather than the parser's. Lower than the ceiling on operator uploads:
 * this parser runs before anyone has proved who they are, so what it will hold in memory for an
 * anonymous request should be the smaller number.
 */
const HARD_UPLOAD_CEILING_BYTES = 16 * 1024 * 1024;

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

  /**
   * Attach evidence to a complaint already filed.
   *
   * Public, because the person who filed has no account — the reference and tracking code issued
   * at filing are the credential, and they are checked before a byte is written. Throttled a shade
   * above the filing route so the three permitted files, plus a retry, fit inside one minute.
   */
  @Post('attachments')
  @Public()
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: HARD_UPLOAD_CEILING_BYTES } }))
  attach(
    @Body() dto: AttachComplaintFileDto,
    @UploadedFile() file: UploadedFileType | undefined,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.complaints.attach(dto.referenceNumber, dto.trackingCode, file, ctx);
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

  @Get(':id/attachments')
  @Roles(...READERS)
  listAttachments(@Param('id', ParseUUIDPipe) id: string) {
    return this.complaints.listAttachments(id);
  }

  /**
   * Open a file a citizen sent in. Authority only, and always as a download: these files arrive
   * from an unauthenticated route and are stored unscanned, so nothing here is rendered in place.
   */
  @Get(':id/attachments/:attachmentId/download')
  @Roles(...READERS)
  async downloadAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { fileName, mimeType, stream } = await this.complaints.downloadAttachment(
      id,
      attachmentId,
    );
    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${fileName.replace(/"/g, '')}"`,
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(stream);
  }

  /** Taking a file off a case is an administrator's call, not a handler's. */
  @Delete(':id/attachments/:attachmentId')
  @Roles(Role.ADMIN)
  removeAttachment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.complaints.removeAttachment(user, id, attachmentId, ctx);
  }
}
