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
import { EntityStatus, EntityType } from '@prisma/client';

export class CreateEntityDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsEnum(EntityType, { message: 'Choose a valid operator type.' })
  type: EntityType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  licenceNumber: string;

  // Optional at creation; set once the Authority verifies the licence.
  @IsOptional()
  @IsEnum(EntityStatus, { message: 'Choose a valid status.' })
  status?: EntityStatus;

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
