import { IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { EnforcementReason, EnforcementStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export const ENFORCEMENT_SORT_COLUMNS = ['openedAt', 'createdAt', 'status'] as const;
export type EnforcementSortColumn = (typeof ENFORCEMENT_SORT_COLUMNS)[number];

export class EnforcementQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(ENFORCEMENT_SORT_COLUMNS)
  sort: EnforcementSortColumn = 'openedAt';

  @IsOptional()
  @IsEnum(EnforcementStatus)
  status?: EnforcementStatus;

  @IsOptional()
  @IsEnum(EnforcementReason)
  reason?: EnforcementReason;

  @IsOptional()
  @IsUUID()
  entityId?: string;

  @IsOptional()
  @IsUUID()
  periodId?: string;
}
