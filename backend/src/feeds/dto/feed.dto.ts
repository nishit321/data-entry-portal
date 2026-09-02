import { Type } from 'class-transformer';
import {
  IsBoolean,
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
import { FeedFrequency } from '@prisma/client';

export class CreateFeedDto {
  @IsUUID()
  agreementId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  /** Checked against the outbound rules before it is saved, and again before every call. */
  @IsString()
  @MaxLength(500)
  url!: string;

  @IsEnum(FeedFrequency, { message: 'Choose how often to collect it.' })
  frequency!: FeedFrequency;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  hour?: number;

  /** Day of the week for a weekly feed, 1 = Monday. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek?: number;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  /** A token the operator issued to NCA. Written and never read back. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  authToken?: string;
}

export class UpdateFeedDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string;

  @IsOptional()
  @IsEnum(FeedFrequency, { message: 'Choose how often to collect it.' })
  frequency?: FeedFrequency;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  hour?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek?: number;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  /** Send an empty string to clear the token; omit it to leave it alone. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  authToken?: string;
}
