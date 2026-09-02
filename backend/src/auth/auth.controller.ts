import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import {
  SignupDto,
  LoginDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyOtpDto,
  ResendOtpDto,
} from './dto/auth.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClientContext } from '../common/decorators/client-context.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import { PhoneVerificationService } from './phone-verification.service';
import { ConfirmPhoneDto, StartPhoneVerificationDto } from './dto/phone.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly phone: PhoneVerificationService,
  ) {}

  @Public()
  @Post('signup')
  signup(@Body() dto: SignupDto, @ClientContext() ctx: RequestContext) {
    return this.auth.signup(dto, ctx);
  }

  // Tighter rate limit on credential endpoints to slow brute-force attempts.
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @ClientContext() ctx: RequestContext) {
    return this.auth.login(dto, ctx);
  }

  // Step 2 of login when MFA is on: exchange the OTP for a token.
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  verifyOtp(@Body() dto: VerifyOtpDto, @ClientContext() ctx: RequestContext) {
    return this.auth.verifyOtp(dto, ctx);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  resendOtp(@Body() dto: ResendOtpDto, @ClientContext() ctx: RequestContext) {
    return this.auth.resendOtp(dto, ctx);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: ForgotPasswordDto, @ClientContext() ctx: RequestContext) {
    return this.auth.forgotPassword(dto, ctx);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto, @ClientContext() ctx: RequestContext) {
    return this.auth.resetPassword(dto, ctx);
  }

  @Get('me')
  me(@CurrentUser('id') userId: string) {
    return this.auth.me(userId);
  }

  /*
   * A phone number is the caller's own, so these carry no @Roles(): every signed-in user may set
   * their own and nobody else's. Recorded with that reason in test/route-inventory.e2e-spec.ts.
   */

  /** Whether a number can be confirmed at all, so the screen can say so before asking for one. */
  @Get('phone')
  phoneAvailability() {
    return { available: this.phone.isAvailable() };
  }

  /**
   * Start confirming a number.
   *
   * Rate limited hard, and separately from the login endpoints. Each call spends the Authority's
   * SMS balance and rings somebody's handset, so this is the one place in the portal where an
   * ordinary request costs money.
   */
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('phone')
  startPhoneVerification(
    @CurrentUser('id') userId: string,
    @Body() dto: StartPhoneVerificationDto,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.phone.start(userId, dto.phone, ctx);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('phone/verify')
  confirmPhone(
    @CurrentUser('id') userId: string,
    @Body() dto: ConfirmPhoneDto,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.phone.confirm(userId, dto.code, ctx);
  }

  @Delete('phone')
  @HttpCode(HttpStatus.NO_CONTENT)
  removePhone(@CurrentUser('id') userId: string, @ClientContext() ctx: RequestContext) {
    return this.phone.remove(userId, ctx);
  }
}
