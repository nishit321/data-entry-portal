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
import { ReportFrequency, ScheduledReportKind } from '@prisma/client';

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
