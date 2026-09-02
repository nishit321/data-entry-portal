import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { RuleSeverity, RuleType } from '@prisma/client';

export class CreateRuleDto {
  @IsEnum(RuleType, { message: 'Choose a valid rule.' })
  type: RuleType;

  @IsOptional()
  @IsEnum(RuleSeverity, { message: 'Choose whether this rule blocks submission or only warns.' })
  severity?: RuleSeverity;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  label: string;

  /** Operand field keys + thresholds; shape depends on `type` (see validation-engine). */
  @IsObject()
  config: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  order?: number;
}

export class UpdateRuleDto {
  @IsOptional()
  @IsEnum(RuleSeverity, { message: 'Choose whether this rule blocks submission or only warns.' })
  severity?: RuleSeverity;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  label?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  order?: number;
}
