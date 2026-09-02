import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { DocumentsService } from './documents.service';
import { DocumentQueryDto, ExpirySweepDto, UploadDocumentDto } from './dto/document.dto';
import type { UploadedFile as UploadedFileType } from '../files/storage.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { ClientContext } from '../common/decorators/client-context.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import { AUTHORITY_ROLES, OPERATOR_ROLES } from '../common/utils/data-scope.util';

// A hard abuse ceiling on the multipart interceptor; the service re-checks against MAX_FILE_MB.
const HARD_UPLOAD_CEILING_BYTES = 64 * 1024 * 1024;

/** Who may file a document: the owning operator, or an Authority administrator on their behalf. */
const UPLOADERS = [Role.OPERATOR_ADMIN, Role.ADMIN] as const;

/** The licence and certificate repository. Reads are scoped to the caller's own entity. */
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @Roles(...OPERATOR_ROLES, ...AUTHORITY_ROLES)
  list(@CurrentUser() user: AuthUser, @Query() query: DocumentQueryDto) {
    return this.documents.findAll(user, query);
  }

  @Post()
  @Roles(...UPLOADERS)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: HARD_UPLOAD_CEILING_BYTES } }))
  upload(
    @CurrentUser() user: AuthUser,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: UploadedFileType | undefined,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.documents.upload(user, dto, file, ctx);
  }

  @Get(':id/download')
  @Roles(...OPERATOR_ROLES, ...AUTHORITY_ROLES)
  async download(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { fileName, mimeType, stream } = await this.documents.download(user, id);
    res.set({
      'Content-Type': mimeType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${fileName.replace(/"/g, '')}"`,
    });
    return new StreamableFile(stream);
  }

  @Post('sweep-expiries')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  sweep(@Query() query: ExpirySweepDto) {
    return this.documents.sweepExpiries(query.withinDays);
  }

  @Delete(':id')
  @Roles(...UPLOADERS)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.documents.remove(user, id, ctx);
  }
}
