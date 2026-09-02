import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { SignaturesService } from './signatures.service';
import { RegisterCertificateDto } from './dto/signature.dto';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { ClientContext } from '../common/decorators/client-context.decorator';
import { RequestContext } from '../common/utils/request-context.util';

/**
 * Signing certificates and the signatures made with them (Q6, Phase 3).
 *
 * No @Roles: any authenticated user may register a certificate of their own and check a signature
 * on a return they are already allowed to see. Scoping is by ownership rather than by role, and
 * enforced in the service.
 */
@Controller('signatures')
export class SignaturesController {
  constructor(private readonly signatures: SignaturesService) {}

  @Get('certificates')
  listMine(@CurrentUser() user: AuthUser) {
    return this.signatures.listMine(user);
  }

  @Post('certificates')
  register(
    @CurrentUser() user: AuthUser,
    @Body() dto: RegisterCertificateDto,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.signatures.register(user, dto, ctx);
  }

  @Delete('certificates/:id')
  revoke(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.signatures.revoke(user, id, ctx);
  }

  /** What to sign. Computed the same way anyone else can compute it. */
  @Get('returns/:id/digest')
  digest(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.signatures.digestFor(user, id);
  }

  /** Check the signature on a return, now. */
  @Get('returns/:id/verify')
  verify(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.signatures.verify(user, id, ctx);
  }
}
