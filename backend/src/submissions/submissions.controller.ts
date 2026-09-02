import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { SubmissionsService } from './submissions.service';
import { BulkUploadService } from './bulk/bulk-upload.service';
import type { UploadedFile as UploadedFileType } from '../files/storage.service';
import { CreateDraftDto, SaveValuesDto, SubmissionQueryDto, SubmitDto } from './dto/submission.dto';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { ClientContext } from '../common/decorators/client-context.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import { AUTHORITY_ROLES } from '../common/utils/data-scope.util';

const OPERATORS = [Role.OPERATOR_ADMIN, Role.OPERATOR_SUBMITTER] as const;

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
// A hard abuse ceiling on the multipart interceptor; the service applies the real limit.
const HARD_UPLOAD_CEILING_BYTES = 16 * 1024 * 1024;

/**
 * Operator returns. Operators create/fill/submit for their OWN entity (data
 * segregation enforced in the service); Authority roles read across all. Editing
 * requires an open period and a draft status.
 */
@Controller('submissions')
export class SubmissionsController {
  constructor(
    private readonly submissions: SubmissionsService,
    private readonly bulk: BulkUploadService,
  ) {}

  @Get()
  @Roles(...OPERATORS, ...AUTHORITY_ROLES)
  findAll(@CurrentUser() user: AuthUser, @Query() query: SubmissionQueryDto) {
    return this.submissions.findAll(user, query);
  }

  // Declared before ':id' so the literal path isn't parsed as a submission id.
  @Get('startable-periods')
  @Roles(...OPERATORS)
  startablePeriods(@CurrentUser() user: AuthUser) {
    return this.submissions.startablePeriods(user);
  }

  @Get(':id')
  @Roles(...OPERATORS, ...AUTHORITY_ROLES)
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.submissions.findOne(user, id);
  }

  @Post()
  @Roles(...OPERATORS)
  getOrCreateDraft(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateDraftDto,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.submissions.getOrCreateDraft(user, dto, ctx);
  }

  /**
   * Autosave, and the one endpoint an operator hits continuously.
   *
   * The global rate limit is 100 requests a minute and is keyed by **IP address**, which is the
   * right key for the endpoints it exists to protect — nobody should be able to grind at the login
   * form from one machine. It is the wrong key here: an operator's staff all share one office
   * connection, and autosave fires every two seconds, so the deadline-day load harness measured the
   * limit being reached with only three people typing at once. That is an ordinary Tuesday at a
   * mobile operator, and they would have been told to slow down.
   *
   * The limit cannot simply be keyed by user instead: this guard runs before authentication, so the
   * only identity available here is an unverified token claim, and trusting one would let anyone
   * mint themselves a fresh budget. So the limit stays keyed by address and this route, which is
   * cheap and authenticated, gets a budget that fits how it is actually used. Twenty people typing
   * flat out from one address still fit inside it.
   */
  @Put(':id/values')
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @Roles(...OPERATORS)
  saveValues(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveValuesDto,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.submissions.saveValues(user, id, dto, ctx);
  }

  @Post(':id/validate')
  @Roles(...OPERATORS, ...AUTHORITY_ROLES)
  validate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.submissions.validate(user, id);
  }

  @Post(':id/revise')
  @Roles(...OPERATORS)
  revise(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.submissions.revise(user, id, ctx);
  }

  @Post(':id/submit')
  @Roles(...OPERATORS)
  submit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitDto,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.submissions.submit(user, id, dto, ctx);
  }

  // Deleting a draft is the operator's own call. The Authority reviews returns; it does not
  // discard work in progress on an operator's behalf.
  @Delete(':id')
  @Roles(...OPERATORS)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.submissions.remove(user, id, ctx);
  }

  /** Download the return as a workbook to fill in offline (Authority may take a copy too). */
  @Get(':id/workbook')
  @Roles(...OPERATORS, ...AUTHORITY_ROLES)
  async workbook(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const buffer = await this.bulk.buildWorkbook(user, id);
    const fileName = `return-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.set({
      'Content-Type': XLSX_TYPE,
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': String(buffer.length),
    });
    return new StreamableFile(buffer);
  }

  /** Load a filled workbook into the draft. */
  @Post(':id/workbook')
  @Roles(...OPERATORS)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: HARD_UPLOAD_CEILING_BYTES } }))
  uploadWorkbook(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedFileType | undefined,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.bulk.upload(user, id, file, ctx);
  }
}
