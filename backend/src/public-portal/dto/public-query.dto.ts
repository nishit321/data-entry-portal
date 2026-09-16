import { Type } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * What a reader may narrow the public figures by (NCA, 15 September 2026).
 *
 * "Public Portal: Implement filtering and search capabilities."
 *
 * The list is short, and what is missing from it is the point. Every field here narrows the
 * *questions* asked or the *periods* covered. None of them narrows the set of operators a figure
 * rests on, and none ever should: the disclosure threshold works by counting contributors, so a
 * filter that could reduce that count to one or two would hand back a named company's figures
 * through arithmetic the reader never had to do. NCA's own instruction is that the portal is
 * aggregated and sector-level, so there is nothing to add here that would be publishable anyway.
 *
 * Unknown query parameters are stripped by the global validation pipe, so a hand-written URL
 * cannot reach the query builder with a filter this class does not declare.
 */
export class PublicIndicatorQueryDto {
  /** How much history the series carries, when no explicit range is given. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  periods?: number;

  /** Earliest period to include, by the date its returns were due. */
  @IsOptional()
  @IsISO8601()
  from?: string;

  /** Latest period to include, by the date its returns were due. */
  @IsOptional()
  @IsISO8601()
  to?: string;

  /** A single published indicator, when a reader has picked one out of the list. */
  @IsOptional()
  @IsUUID()
  indicatorId?: string;

  /** Free text over what each figure is called and what it means. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}
