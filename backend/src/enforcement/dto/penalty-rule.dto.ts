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

  /**
   * Floor on the total, for a line the Act states as "a percentage, minimum X".
   *
   * Tier 2 is exactly that shape: 0.2% of audited annual revenue, minimum SSP 50m. Without a floor
   * a small operator's breach prices at almost nothing, which is not a deterrent.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Give the minimum as an amount in SSP.' })
  @Min(0, { message: 'A minimum cannot be negative.' })
  minAmount?: number;

  /**
   * Percentage of the operator's audited annual revenue.
   *
   * Set this and the line is priced on the operator's size rather than on how long the default ran
   * — which is how Tiers 2 and 3 are written. The fixed and daily amounts are then not used, since
   * adding them would invent a penalty nobody wrote.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 }, { message: 'Give the share as a percentage, e.g. 0.2.' })
  @Min(0, { message: 'A percentage cannot be negative.' })
  @Max(100, { message: 'A percentage cannot exceed 100.' })
  percentOfRevenue?: number;

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
