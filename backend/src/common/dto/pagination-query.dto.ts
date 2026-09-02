import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../constants/pagination.constants';

export type SortOrder = 'asc' | 'desc';

/**
 * Base query DTO for paginated list endpoints. Features extend this and add a
 * `sort` field validated against their own allow-list of columns (never
 * interpolate a raw client string into `orderBy`).
 */
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = DEFAULT_PAGE;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = DEFAULT_PAGE_SIZE;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order: SortOrder = 'desc';
}
