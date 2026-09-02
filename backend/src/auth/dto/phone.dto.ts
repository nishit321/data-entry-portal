import { IsString, Length, MaxLength, MinLength } from 'class-validator';

export class StartPhoneVerificationDto {
  /**
   * However the person writes it. `normalisePhone` decides whether it is a number, so the rules
   * here only keep something absurd from reaching the service.
   */
  @IsString({ message: 'Enter a phone number.' })
  @MinLength(6, { message: 'That is too short to be a phone number.' })
  @MaxLength(24, { message: 'That is too long to be a phone number.' })
  phone!: string;
}

export class ConfirmPhoneDto {
  @IsString({ message: 'Enter the code we sent you.' })
  @Length(4, 8, { message: 'Enter the code we sent you.' })
  code!: string;
}
