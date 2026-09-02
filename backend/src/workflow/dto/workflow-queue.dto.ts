import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export const WORKFLOW_QUEUE_SORT_COLUMNS = ['submittedAt', 'createdAt', 'referenceNumber'] as const;
export type WorkflowQueueSortColumn = (typeof WORKFLOW_QUEUE_SORT_COLUMNS)[number];

/** Filters/sort for a reviewer's queue — same triage tools as the submissions list, scoped to the
 *  caller's stage. Oldest-waiting first by default so nothing sits at the bottom forever. */
export class WorkflowQueueQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(WORKFLOW_QUEUE_SORT_COLUMNS)
  sort: WorkflowQueueSortColumn = 'submittedAt';

  @IsOptional()
  @IsUUID()
  entityId?: string;

  @IsOptional()
  @IsUUID()
  templateId?: string;

  @IsOptional()
  @IsUUID()
  periodId?: string;

  /** "true"/"false" — coerced in the service (avoids pipe boolean-conversion quirks). */
  @IsOptional()
  @IsIn(['true', 'false'])
  isLate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
