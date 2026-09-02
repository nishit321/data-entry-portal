import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Reading back what the feeds have collected. */
export class FeedMetricQueryDto {
  /** Authority only: narrow to one operator. Operators are always scoped to their own. */
  @IsOptional()
  @IsUUID()
  entityId?: string;

  /** One metric by the name the operator's system reports it under. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  key?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Enter a date.' })
  from?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Enter a date.' })
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  limit?: number;
}
