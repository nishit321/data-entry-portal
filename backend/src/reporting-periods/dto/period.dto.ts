import {
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
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
  @IsOptional()
  @IsIn([PeriodStatus.SCHEDULED, PeriodStatus.OPEN], {
    message: 'A new period can only be Scheduled or Open.',
  })
  status?: PeriodStatus;
}

export class UpdatePeriodDto {
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
