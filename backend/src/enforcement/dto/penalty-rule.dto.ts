import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { EnforcementReason, EntityType } from '@prisma/client';

/** Upper bound on a single line of the schedule. Well above any realistic figure, and there so a
 * mistyped amount is caught at the form rather than after a case has been priced by it. */
const MAX_AMOUNT = 1_000_000_000;

export class CreatePenaltyRuleDto {
  @IsOptional()
  @IsEnum(EnforcementReason, { message: 'Choose a contravention from the list.' })
  reason?: EnforcementReason;

  /** Leave unset for a line that applies to every class of operator. */
  @IsOptional()
  @IsEnum(EntityType, { message: 'Choose an operator type from the list.' })
  entityType?: EntityType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Enter an amount with at most two decimals.' })
  @Min(0)
  @Max(MAX_AMOUNT)
  fixedAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Enter an amount with at most two decimals.' })
  @Min(0)
  @Max(MAX_AMOUNT)
  dailyAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Enter an amount with at most two decimals.' })
  @Min(0)
  @Max(MAX_AMOUNT)
  maxAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @IsDateString({}, { message: 'Enter a date.' })
  effectiveFrom!: string;

  @IsOptional()
  @IsDateString({}, { message: 'Enter a date.' })
  effectiveTo?: string;
}

export class UpdatePenaltyRuleDto extends CreatePenaltyRuleDto {
  @IsOptional()
  @IsDateString({}, { message: 'Enter a date.' })
  declare effectiveFrom: string;
}
