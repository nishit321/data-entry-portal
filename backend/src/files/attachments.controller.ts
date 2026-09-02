import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { AttachmentsService } from './attachments.service';
import { UploadAttachmentDto } from './dto/upload-attachment.dto';
import { UploadedFile as UploadedFileType } from './storage.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { ClientContext } from '../common/decorators/client-context.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import { AUTHORITY_ROLES } from '../common/utils/data-scope.util';

const OPERATORS = [Role.OPERATOR_ADMIN, Role.OPERATOR_SUBMITTER] as const;
// A hard abuse ceiling on the multipart interceptor, set above the configurable MAX_FILE_MB so the
// friendly, config-based size check in the service is what a normal oversized upload actually hits.
const HARD_UPLOAD_CEILING_BYTES = 64 * 1024 * 1024;

/** Supporting files (coverage maps, fibre data, agent registers, documents) on a submission. */
@Controller('submissions/:id/attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post()
  @Roles(...OPERATORS)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: HARD_UPLOAD_CEILING_BYTES } }))
  upload(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UploadAttachmentDto,
    @UploadedFile() file: UploadedFileType | undefined,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.attachments.upload(user, id, dto.kind, file, ctx);
  }

  @Get()
  @Roles(...OPERATORS, ...AUTHORITY_ROLES)
  list(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.attachments.list(user, id);
  }

  @Get(':attachmentId/download')
  @Roles(...OPERATORS, ...AUTHORITY_ROLES)
  async download(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { fileName, mimeType, stream } = await this.attachments.download(user, id, attachmentId);
    res.set({
      'Content-Type': mimeType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${fileName.replace(/"/g, '')}"`,
    });
    return new StreamableFile(stream);
  }

  @Delete(':attachmentId')
  @Roles(...OPERATORS)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.attachments.remove(user, id, attachmentId, ctx);
  }
}
