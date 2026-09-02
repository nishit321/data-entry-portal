import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { AGENT_SORT_COLUMNS, AgentSortColumn } from '../agents.constants';

export class AgentQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(AGENT_SORT_COLUMNS)
  sort: AgentSortColumn = 'createdAt';

  /** Only honoured for Authority callers; operators are always scoped to their own entity. */
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : value === 'true' || value === true))
  @IsBoolean()
  isActive?: boolean;

  /** Free-text search over name and agent reference. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
