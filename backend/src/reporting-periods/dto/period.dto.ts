import {
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PeriodStatus, ReportingFrequency } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  PERIOD_FREQUENCIES,
  PERIOD_SORT_COLUMNS,
  PeriodSortColumn,
} from '../reporting-periods.constants';

export class CreatePeriodDto {
  @IsUUID()
  templateId: string;

  @IsIn(PERIOD_FREQUENCIES, { message: 'Choose Monthly, Quarterly or Annual.' })
  frequency: ReportingFrequency;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  label: string;

  @IsISO8601()
  periodStart: string;

  @IsISO8601()
  periodEnd: string;

  @IsISO8601()
  dueDate: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  graceDays?: number;

  /** SCHEDULED to prepare ahead of time, or OPEN (default) to accept submissions now. */
  /**
   * SSP per USD for this cycle.
   *
   * Left out and the period carries forward whatever the last one used, which is what an
   * administrator scheduling next quarter almost always wants. Setting it here is the deliberate
   * act of saying the rate has moved.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 }, { message: 'Give the rate as a number, e.g. 7000.' })
  @IsPositive({ message: 'The rate must be more than zero.' })
  usdRate?: number;

  @IsOptional()
  @IsIn([PeriodStatus.SCHEDULED, PeriodStatus.OPEN], {
    message: 'A new period can only be Scheduled or Open.',
  })
  status?: PeriodStatus;
}

export class UpdatePeriodDto {
  /**
   * Changing this restates every USD figure for this cycle and no other.
   *
   * That containment is the whole reason the rate sits on the period: correcting a
   * mistyped rate for one quarter must not touch a year that has already been audited.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 }, { message: 'Give the rate as a number, e.g. 7000.' })
  @IsPositive({ message: 'The rate must be more than zero.' })
  usdRate?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  label?: string;

  @IsOptional()
  @IsISO8601()
  periodStart?: string;

  @IsOptional()
  @IsISO8601()
  periodEnd?: string;

  @IsOptional()
  @IsISO8601()
  dueDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  graceDays?: number;
}

export class PeriodQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(PERIOD_SORT_COLUMNS)
  sort: PeriodSortColumn = 'dueDate';

  @IsOptional()
  @IsUUID()
  templateId?: string;

  @IsOptional()
  @IsEnum(PeriodStatus, { message: 'Choose a valid status.' })
  status?: PeriodStatus;

  @IsOptional()
  @IsEnum(ReportingFrequency, { message: 'Choose Monthly, Quarterly or Annual.' })
  frequency?: ReportingFrequency;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
