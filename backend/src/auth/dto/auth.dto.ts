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

  @IsString()
  @MinLength(4)
  @MaxLength(10)
  code: string;
}

export class ResendOtpDto {
  @IsUUID()
  challengeId: string;
}
