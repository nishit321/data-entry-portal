import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { EntityStatus, EntityType } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ENTITY_SORT_COLUMNS, EntitySortColumn } from '../entities.constants';

export class EntityQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(ENTITY_SORT_COLUMNS)
  sort: EntitySortColumn = 'createdAt';

  @IsOptional()
  @IsEnum(EntityType, { message: 'Choose a valid operator type.' })
  type?: EntityType;

  @IsOptional()
  @IsEnum(EntityStatus, { message: 'Choose a valid status.' })
  status?: EntityStatus;

  /** Free-text search over name and licence number. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
