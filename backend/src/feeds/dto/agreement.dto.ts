import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AgreementStatus } from '@prisma/client';

export class CreateAgreementDto {
  @IsUUID()
  entityId!: string;

  /** The Authority's own reference for the signed instrument. */
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  reference!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  /** What the operator has agreed NCA may collect, in the agreement's own words. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  scope?: string;

  @IsOptional()
  @IsEnum(AgreementStatus, { message: 'Choose a status from the list.' })
  status?: AgreementStatus;

  @IsOptional()
  @IsDateString({}, { message: 'Enter the date it was signed.' })
  signedAt?: string;

  @IsDateString({}, { message: 'Enter the date it starts.' })
  startsAt!: string;

  /** Leave blank for an open-ended agreement. */
  @IsOptional()
  @IsDateString({}, { message: 'Enter the date it ends.' })
  endsAt?: string;
}

export class UpdateAgreementDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  scope?: string;

  @IsOptional()
  @IsEnum(AgreementStatus, { message: 'Choose a status from the list.' })
  status?: AgreementStatus;

  @IsOptional()
  @IsDateString({}, { message: 'Enter the date it was signed.' })
  signedAt?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Enter the date it starts.' })
  startsAt?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Enter the date it ends.' })
  endsAt?: string;
}
