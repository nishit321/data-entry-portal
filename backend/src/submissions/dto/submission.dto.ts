import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { SubmissionStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { SUBMISSION_SORT_COLUMNS, SubmissionSortColumn } from '../submissions.constants';

/** Create (or resume) the operator's draft for a period. */
export class CreateDraftDto {
  @IsUUID()
  periodId: string;
}

/** One answered field. Value held as text; "Data unavailable" = NULL + reason. */
export class SubmissionValueDto {
  @IsUUID()
  fieldId: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  valueText?: string;

  @IsOptional()
  @IsBoolean()
  isUnavailable?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  unavailableReason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  otherText?: string;
}

export class SaveValuesDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => SubmissionValueDto)
  values: SubmissionValueDto[];
}

export class SubmitDto {
  /** Simple e-signature: the signer's typed name (Q6). */
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(150)
  signedName: string;

  /**
   * Certificate-based signature (Q6, Phase 3). Both parts are supplied together or not at all: a
   * signature with no certificate cannot be checked, and a certificate with no signature signs
   * nothing.
   */
  @IsOptional()
  @IsUUID()
  signingCertificateId?: string;

  /** The signature over the return's digest, base64. */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  signature?: string;
}

export class SubmissionQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(SUBMISSION_SORT_COLUMNS)
  sort: SubmissionSortColumn = 'createdAt';

  @IsOptional()
  @IsEnum(SubmissionStatus, { message: 'Choose a valid status.' })
  status?: SubmissionStatus;

  @IsOptional()
  @IsUUID()
  periodId?: string;

  /** Authority-only filter; ignored for operators (scoped to their own entity). */
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @IsOptional()
  @IsUUID()
  templateId?: string;

  /** Filter by late/on-time. Kept as the query string ("true"/"false") and coerced in the
   * service, so it doesn't depend on the pipe's boolean-conversion behaviour. */
  @IsOptional()
  @IsIn(['true', 'false'])
  isLate?: string;

  /** Inclusive submitted-date range (yyyy-mm-dd). */
  @IsOptional()
  @IsDateString()
  submittedFrom?: string;

  @IsOptional()
  @IsDateString()
  submittedTo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
