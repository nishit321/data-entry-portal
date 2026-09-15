import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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
import { ReportCoverage, ReportFrequency, ScheduledReportKind } from '@prisma/client';

export class CreateReportScheduleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsEnum(ScheduledReportKind, { message: 'Choose a report from the list.' })
  kind?: ScheduledReportKind;

  @IsOptional()
  @IsEnum(ReportFrequency, { message: 'Choose how often it should go out.' })
  frequency?: ReportFrequency;

  /**
   * Which period each run covers, worked out when it goes out rather than fixed here.
   *
   * The distinction a recurring report lives or dies on. A levy statement is about a period that
   * has finished; a compliance report is about the one still open, because it exists to chase the
   * operators who have not filed for it.
   */
  @IsOptional()
  @IsEnum(ReportCoverage, { message: 'Choose what each report should cover.' })
  coverage?: ReportCoverage;

  /** Day of the month for a monthly or quarterly report; day of the week for a weekly one. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(28)
  dayOfPeriod?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  hour?: number;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  /** Authority staff who receive it. Ids, never typed-in addresses. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true, message: 'Choose recipients from the staff list.' })
  recipientIds?: string[];
}

export class UpdateReportScheduleDto extends CreateReportScheduleDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  declare name: string;
}
