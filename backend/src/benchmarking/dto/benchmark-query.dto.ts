import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { EntityType } from '@prisma/client';

/**
 * Filters shared by the benchmark endpoints. An operator is always compared against its own kind
 * of peer, so `entityType` here only narrows the view for Authority readers.
 */
export class BenchmarkQueryDto {
  @IsOptional()
  @IsEnum(EntityType, { message: 'Choose an operator type from the list.' })
  entityType?: EntityType;

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

/** Comparing one reported figure across the peer group. */
export class IndicatorBenchmarkQueryDto extends BenchmarkQueryDto {
  @IsString()
  @MaxLength(120)
  fieldKey!: string;
}
