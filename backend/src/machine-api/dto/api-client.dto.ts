import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiClientStatus, ApiScope } from '@prisma/client';

export class CreateApiClientDto {
  /** Authority only: which operator this credential belongs to. Operators get their own. */
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsArray()
  @ArrayMaxSize(8)
  @IsEnum(ApiScope, { each: true, message: 'Choose what this credential may do.' })
  scopes!: ApiScope[];

  /** SHA-256 fingerprint of the client certificate, in any of the usual forms. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  certFingerprint?: string;

  /** Addresses or CIDR ranges this credential may be used from. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  allowedCidrs?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(6000)
  rateLimitPerMinute?: number;

  /** Leave unset for the default lifetime. */
  @IsOptional()
  @IsDateString({}, { message: 'Enter an expiry date.' })
  expiresAt?: string;
}

export class UpdateApiClientDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsEnum(ApiScope, { each: true, message: 'Choose what this credential may do.' })
  scopes?: ApiScope[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  certFingerprint?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  allowedCidrs?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(6000)
  rateLimitPerMinute?: number;

  /** Suspend or restore. Revoking is its own action and cannot be undone. */
  @IsOptional()
  @IsEnum(ApiClientStatus, { message: 'Choose a status from the list.' })
  status?: ApiClientStatus;

  @IsOptional()
  @IsDateString({}, { message: 'Enter an expiry date.' })
  expiresAt?: string;
}
