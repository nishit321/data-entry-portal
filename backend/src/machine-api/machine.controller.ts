import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiScope } from '@prisma/client';
import { MachineAuthGuard, type MachineRequest } from './machine-auth.guard';
import { MachineRoute, RequireScopes } from './machine.decorators';
import { MachineApiService } from './machine-api.service';
import { MachineSaveValuesDto, MachineStartReturnDto, MachineSubmitDto } from './dto/machine.dto';

/**
 * The system-to-system API (Q10, Phase 3).
 *
 * An operator's own systems file returns here instead of a person typing them in. Deliberately
 * narrow: start a return, put values into it, submit it, and read back what is due and what has
 * been filed. Everything an operator can do at a keyboard is *not* mirrored — a machine has no
 * business deleting a draft or arguing with a reviewer.
 *
 * The path segment `/machine/` is what the raw-body middleware keys off, so it is part of the
 * contract rather than a naming preference.
 */
@Controller('machine')
@MachineRoute()
@UseGuards(MachineAuthGuard)
export class MachineController {
  constructor(private readonly machine: MachineApiService) {}

  /**
   * Confirms who the caller is and what it may do.
   *
   * The first thing any integrator wants: a request that proves the credential, the signature, the
   * certificate and the address are all right, without filing anything.
   */
  @Get('whoami')
  whoami(@Req() request: MachineRequest) {
    return this.machine.whoami(request.machine!);
  }

  /** Which returns are open for this operator, and when they are due. */
  @Get('periods')
  @RequireScopes(ApiScope.READ_PERIODS)
  periods(@Req() request: MachineRequest) {
    return this.machine.openPeriods(request.machine!);
  }

  /** The questionnaire for a period, so the caller knows what keys to send. */
  @Get('periods/:id/questions')
  @RequireScopes(ApiScope.READ_PERIODS, ApiScope.SUBMIT_RETURNS)
  questions(@Req() request: MachineRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.machine.questions(request.machine!, id);
  }

  /** This operator's filed returns. */
  @Get('returns')
  @RequireScopes(ApiScope.READ_RETURNS)
  returns(@Req() request: MachineRequest) {
    return this.machine.returns(request.machine!);
  }

  /** Open a draft for a period, or hand back the one already open. */
  @Post('returns')
  @RequireScopes(ApiScope.SUBMIT_RETURNS)
  start(@Req() request: MachineRequest, @Body() dto: MachineStartReturnDto) {
    return this.machine.startReturn(request.machine!, dto);
  }

  /**
   * Put values into a draft, addressed by question key rather than by field id.
   *
   * Keys, because an integrator writing against this API has the questionnaire in front of them,
   * not the database. It also means republishing a questionnaire does not break an integration
   * that was working the day before.
   */
  @Put('returns/:id/values')
  @RequireScopes(ApiScope.SUBMIT_RETURNS)
  saveValues(
    @Req() request: MachineRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MachineSaveValuesDto,
  ) {
    return this.machine.saveValues(request.machine!, id, dto);
  }

  /** File the return. Runs the same validation a person filing at a keyboard would meet. */
  @Post('returns/:id/submit')
  @RequireScopes(ApiScope.SUBMIT_RETURNS)
  submit(
    @Req() request: MachineRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MachineSubmitDto,
  ) {
    return this.machine.submit(request.machine!, id, dto);
  }
}
