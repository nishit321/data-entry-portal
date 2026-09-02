import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { EntityType, ReportingFrequency } from '@prisma/client';

export class CreateSectionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: 'Key may contain only letters, digits, _ and -' })
  key: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  order?: number;

  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(EntityType, { each: true, message: 'Choose a valid operator type.' })
  applicableEntityTypes: EntityType[];

  @IsEnum(ReportingFrequency, { message: 'Choose Monthly, Quarterly or Annual.' })
  frequency: ReportingFrequency;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  requiredServiceCode?: string;
}

export class UpdateSectionDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  order?: number;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(EntityType, { each: true, message: 'Choose a valid operator type.' })
  applicableEntityTypes?: EntityType[];

  @IsOptional()
  @IsEnum(ReportingFrequency, { message: 'Choose Monthly, Quarterly or Annual.' })
  frequency?: ReportingFrequency;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  requiredServiceCode?: string;
}
