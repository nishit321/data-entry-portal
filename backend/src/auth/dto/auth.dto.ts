import { IsEmail, IsNotEmpty, IsString, IsUUID, MinLength, MaxLength } from 'class-validator';

export class SignupDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(72)
  password: string;
}

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(72)
  password: string;
}

export class VerifyOtpDto {
  @IsUUID()
  challengeId: string;

  /**
   * The emailed code, the authenticator app's six digits, or a recovery code.
   *
   * The upper bound has to clear a recovery code (`ABCDE-FGHIJ`), which is longer than any code
   * the server itself issues. Left too tight, a recovery code is refused by validation before the
   * login flow ever sees it, and the only way back into an account with a lost phone is closed by
   * a number in a decorator.
   */
  @IsString()
  @MinLength(4)
  @MaxLength(20)
  code: string;
}

export class ResendOtpDto {
  @IsUUID()
  challengeId: string;
}
