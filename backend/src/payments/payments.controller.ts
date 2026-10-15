import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { ClientContext } from '../common/decorators/client-context.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import { OPERATOR_ROLES } from '../common/utils/data-scope.util';
import { PaymentsService } from './payments.service';
import {
  BalancesQueryDto,
  PaymentQueryDto,
  RecordPaymentDto,
  ReversePaymentDto,
} from './dto/payment.dto';

/**
 * Who reads money, and who handles it.
 *
 * Reading: the operator (its own, always) and the Authority's finance-facing staff. The three
 * review stages are left out: checking a return's figures is not the same job as knowing what an
 * operator has paid, and a reviewer has no reason to see it.
 *
 * Recording and reversing: supervisors and administrators only, the same pair that resolves and
 * waives the cases these payments settle.
 */
const READERS = [...OPERATOR_ROLES, Role.ADMIN, Role.SUPERVISOR, Role.ANALYST];
const HANDLERS = [Role.ADMIN, Role.SUPERVISOR];

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('balances')
  @Roles(...READERS)
  balances(@CurrentUser() user: AuthUser, @Query() query: BalancesQueryDto) {
    return this.payments.balances(user, query);
  }

  @Get()
  @Roles(...READERS)
  list(@CurrentUser() user: AuthUser, @Query() query: PaymentQueryDto) {
    return this.payments.list(user, query);
  }

  @Post()
  @Roles(...HANDLERS)
  record(
    @CurrentUser() user: AuthUser,
    @Body() dto: RecordPaymentDto,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.payments.record(user, dto, ctx);
  }

  @Post(':id/reverse')
  @Roles(...HANDLERS)
  @HttpCode(HttpStatus.OK)
  reverse(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReversePaymentDto,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.payments.reverse(user, id, dto, ctx);
  }

  @Get(':id/receipt.pdf')
  @Roles(...READERS)
  async receipt(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.payments.receipt(user, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    return new StreamableFile(buffer);
  }
}
