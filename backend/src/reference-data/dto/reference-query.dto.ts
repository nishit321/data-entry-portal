import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ReferenceCategory } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { REFERENCE_SORT_COLUMNS, ReferenceSortColumn } from '../reference-data.constants';

export class ReferenceQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(REFERENCE_SORT_COLUMNS)
  sort: ReferenceSortColumn = 'sortOrder';

  @IsOptional()
  @IsEnum(ReferenceCategory, { message: 'Choose a valid reference list.' })
  category?: ReferenceCategory;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : value === 'true' || value === true))
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
