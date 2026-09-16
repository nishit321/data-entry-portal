import { IsString, Length } from 'class-validator';

/**
 * A code from the authenticator app, or a recovery code.
 *
 * One DTO for both because the service decides which it is by shape: six digits is an app code,
 * anything else is treated as a recovery code. Splitting them here would make the caller declare
 * something it does not reliably know.
 */
export class TotpCodeDto {
  @IsString({ message: 'Enter the code from your authenticator app.' })
  @Length(6, 20, { message: 'Enter the six-digit code, or one of your recovery codes.' })
  code!: string;
}
