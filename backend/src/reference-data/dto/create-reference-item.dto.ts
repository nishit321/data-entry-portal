import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { ReferenceCategory } from '@prisma/client';

export class CreateReferenceItemDto {
  @IsEnum(ReferenceCategory, { message: 'Choose a valid reference list.' })
  category: ReferenceCategory;

  /** Stable machine key within the category (letters, digits, _ and -). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'Code may contain only letters, digits, underscores and hyphens',
  })
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  label: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
