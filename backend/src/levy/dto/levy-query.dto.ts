import { IsOptional, IsUUID } from 'class-validator';

/** Assessments are computed for one reporting period; omit to use the reader's most recent one. */
export class LevyAssessmentQueryDto {
  @IsOptional()
  @IsUUID()
  periodId?: string;

  /** Authority-only: narrow to one operator. Operators are always scoped to their own entity. */
  @IsOptional()
  @IsUUID()
  entityId?: string;
}
