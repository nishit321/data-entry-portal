import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ReviewDecision } from '@prisma/client';

/** A reviewer's decision at their stage. A comment is required when rejecting (checked in the service). */
export class ReviewDecisionDto {
  @IsEnum(ReviewDecision, { message: 'Decision must be approve or reject' })
  decision: ReviewDecision;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
