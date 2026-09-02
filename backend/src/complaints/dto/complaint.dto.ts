import {
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ComplaintCategory, ComplaintStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/** What a member of the public sends in. Contact details are optional: filing may be anonymous. */
export class FileComplaintDto {
  @IsEnum(ComplaintCategory, { message: 'Choose what your message is about' })
  category: ComplaintCategory;

  @IsString()
  @MinLength(4, { message: 'Give your message a subject of at least 4 characters' })
  @MaxLength(160)
  subject: string;

  @IsString()
  @MinLength(20, { message: 'Describe what happened in at least 20 characters' })
  @MaxLength(4000, { message: 'Keep the description under 4000 characters' })
  description: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  complainantName?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Enter a valid email address, or leave it blank' })
  @MaxLength(160)
  complainantEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  complainantPhone?: string;

  /** The operator the complaint is about, when the citizen names one. */
  @IsOptional()
  @IsUUID()
  aboutEntityId?: string;
}

/** Reference plus the secret tracking code: both are needed to read a complaint back. */
export class TrackComplaintDto {
  @IsString()
  @MaxLength(40)
  referenceNumber: string;

  @IsString()
  @MaxLength(80)
  trackingCode: string;
}

export const COMPLAINT_SORT_COLUMNS = ['createdAt', 'status', 'category'] as const;
export type ComplaintSortColumn = (typeof COMPLAINT_SORT_COLUMNS)[number];

export class ComplaintQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(COMPLAINT_SORT_COLUMNS)
  sort: ComplaintSortColumn = 'createdAt';

  @IsOptional()
  @IsEnum(ComplaintStatus)
  status?: ComplaintStatus;

  @IsOptional()
  @IsEnum(ComplaintCategory)
  category?: ComplaintCategory;

  @IsOptional()
  @IsUUID()
  aboutEntityId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

/** The Authority moving a case along, with a note the citizen may be told. */
export class UpdateComplaintStatusDto {
  @IsEnum(ComplaintStatus, { message: 'Choose a valid status' })
  status: ComplaintStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resolutionNote?: string;
}
