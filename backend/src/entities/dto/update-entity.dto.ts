import {
  IsEmail,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { EntityType } from '@prisma/client';

/**
 * Editable entity attributes. Status is changed through its own endpoint
 * (PATCH /entities/:id/status) so the change is audited distinctly.
 */
export class UpdateEntityDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsEnum(EntityType, { message: 'Choose a valid operator type.' })
  type?: EntityType;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  licenceNumber?: string;

  @IsOptional()
  @IsISO8601()
  licenceIssuedAt?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(200)
  yearsInOperation?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  geographicScope?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  headquartersAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  primaryContactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  primaryContactTitle?: string;

  @IsOptional()
  @IsEmail()
  primaryContactEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  primaryContactPhone?: string;
}
