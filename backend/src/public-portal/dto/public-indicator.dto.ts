import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PublicAggregation } from '@prisma/client';

/** Adding a question to the public allowlist (Q4). Administrators only. */
export class CreatePublicIndicatorDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  fieldKey!: string;

  @IsOptional()
  @IsEnum(PublicAggregation, { message: 'Choose how the figure is combined.' })
  aggregation?: PublicAggregation;

  /** What a citizen reads. Kept separate from the questionnaire's own wording on purpose. */
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  label!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  unit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  order?: number;

  /** Off unless set. Adding a line and publishing it stay two separate decisions. */
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

export class UpdatePublicIndicatorDto {
  @IsOptional()
  @IsEnum(PublicAggregation, { message: 'Choose how the figure is combined.' })
  aggregation?: PublicAggregation;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  unit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  order?: number;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}
