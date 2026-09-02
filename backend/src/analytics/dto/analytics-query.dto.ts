import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { BooleanQuery } from '../../common/dto/boolean-query.decorator';

/** Filters shared by the analytics endpoints. Operators are always scoped to their own entity, so
 * `entityId` here only narrows the view for Authority readers. */
export class AnalyticsQueryDto {
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @IsOptional()
  @IsUUID()
  templateId?: string;

  @IsOptional()
  @IsUUID()
  periodId?: string;
}

/** The trends endpoint additionally accepts how many recent periods to chart. */
export class TrendsQueryDto extends AnalyticsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  periods: number = 8;
}

/** Filters for the trend and anomaly sweep. */
export class AnomalyQueryDto extends AnalyticsQueryDto {
  /** Only show flags at this severity. */
  @IsOptional()
  @IsIn(['HIGH', 'MEDIUM'])
  severity?: 'HIGH' | 'MEDIUM';

  /**
   * How far a figure must move from its baseline before it is worth a look. Lower it to widen the
   * net; the default is a judgement about how much an ordinary quarter moves.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(1000)
  thresholdPercent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  /**
   * Include questions being reported for the first time. Off by default: the quarter a new
   * questionnaire goes live, every figure is a first report, and a list of hundreds of them
   * buries the movements that actually need a look.
   */
  @BooleanQuery('includeFirstReports')
  includeFirstReports?: boolean;
}
