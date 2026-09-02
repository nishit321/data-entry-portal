import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { FieldType, FlowOrStock, ReferenceCategory, ReportingFrequency } from '@prisma/client';

export class CreateFieldDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: 'Key may contain only letters, digits, _ and -' })
  key: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  label: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  order?: number;

  @IsEnum(FieldType, { message: 'Choose a valid answer type.' })
  dataType: FieldType;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  unit?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  decimals?: number;

  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;

  @IsOptional()
  @IsEnum(FlowOrStock, { message: 'Choose how this figure is rolled up for the year.' })
  flowOrStock?: FlowOrStock;

  @IsOptional()
  @IsNumber()
  minValue?: number;

  @IsOptional()
  @IsNumber()
  maxValue?: number;

  @IsOptional()
  @IsEnum(ReferenceCategory, { message: 'Choose a valid reference list.' })
  referenceCategory?: ReferenceCategory;

  @IsOptional()
  @IsBoolean()
  allowsOther?: boolean;

  @IsOptional()
  @IsEnum(ReportingFrequency, { message: 'Choose Monthly, Quarterly or Annual.' })
  frequencyOverride?: ReportingFrequency;

  @IsOptional()
  @IsBoolean()
  isLevyBasis?: boolean;
}

export class UpdateFieldDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  label?: string;

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
  @IsEnum(FieldType, { message: 'Choose a valid answer type.' })
  dataType?: FieldType;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  unit?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  decimals?: number;

  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;

  @IsOptional()
  @IsEnum(FlowOrStock, { message: 'Choose how this figure is rolled up for the year.' })
  flowOrStock?: FlowOrStock;

  @IsOptional()
  @IsNumber()
  minValue?: number;

  @IsOptional()
  @IsNumber()
  maxValue?: number;

  @IsOptional()
  @IsEnum(ReferenceCategory, { message: 'Choose a valid reference list.' })
  referenceCategory?: ReferenceCategory;

  @IsOptional()
  @IsBoolean()
  allowsOther?: boolean;

  @IsOptional()
  @IsEnum(ReportingFrequency, { message: 'Choose Monthly, Quarterly or Annual.' })
  frequencyOverride?: ReportingFrequency;

  @IsOptional()
  @IsBoolean()
  isLevyBasis?: boolean;
}
