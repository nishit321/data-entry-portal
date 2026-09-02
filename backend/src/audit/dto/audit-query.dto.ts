import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { AuditAction } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/** Columns an audit listing may be sorted by (allow-list — never a raw client string). */
export const AUDIT_SORT_COLUMNS = ['createdAt', 'action'] as const;
export type AuditSortColumn = (typeof AUDIT_SORT_COLUMNS)[number];

/**
 * Filters for the Authority-only audit log. The trail is append-only and never
 * filtered for correctness — these narrow what an investigator is looking at.
 */
export class AuditQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(AUDIT_SORT_COLUMNS)
  sort: AuditSortColumn = 'createdAt';

  @IsOptional()
  @IsEnum(AuditAction, { message: 'Choose a valid action.' })
  action?: AuditAction;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  entityType?: string;

  @IsOptional()
  @IsUUID()
  entityId?: string;

  @IsOptional()
  @IsUUID()
  actorId?: string;

  /** Inclusive created-date range (yyyy-mm-dd), applied to createdAt. */
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
