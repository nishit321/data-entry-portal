import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { DocumentKind } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/** Multipart body accompanying an upload. Numbers arrive as strings, hence the transforms. */
export class UploadDocumentDto {
  @IsEnum(DocumentKind, { message: 'Choose a valid document type' })
  kind: DocumentKind;

  @IsString()
  @MinLength(2, { message: 'Give the document a title of at least 2 characters' })
  @MaxLength(160)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  reference?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Enter the issue date as a date' })
  issuedAt?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Enter the expiry date as a date' })
  expiresAt?: string;

  /**
   * When replacing an existing document, the version it supersedes. The new upload becomes the
   * current version and the old one is retained as history.
   */
  @IsOptional()
  @IsUUID()
  supersedesId?: string;

  /** Authority-only: whose repository to file this into. Operators upload to their own. */
  @IsOptional()
  @IsUUID()
  entityId?: string;
}

export const DOCUMENT_SORT_COLUMNS = ['createdAt', 'expiresAt', 'title'] as const;
export type DocumentSortColumn = (typeof DOCUMENT_SORT_COLUMNS)[number];

export class DocumentQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(DOCUMENT_SORT_COLUMNS)
  sort: DocumentSortColumn = 'createdAt';

  @IsOptional()
  @IsEnum(DocumentKind)
  kind?: DocumentKind;

  @IsOptional()
  @IsUUID()
  entityId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  /**
   * Kept as a string and coerced in the service: the global ValidationPipe's implicit conversion
   * turns the string 'false' into boolean true.
   */
  @IsOptional()
  @IsIn(['true', 'false'])
  expiringOnly?: 'true' | 'false';
}

/** How many days ahead the expiry sweep starts warning. */
export class ExpirySweepDto {
  @IsOptional()
  @Type(() => Number)
  withinDays?: number;
}
