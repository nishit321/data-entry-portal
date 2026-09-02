import { IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterCertificateDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  label!: string;

  /** The PEM text. Only the public half; a private key is never accepted here. */
  @IsString()
  @MinLength(64)
  @MaxLength(20000)
  certificatePem!: string;
}
