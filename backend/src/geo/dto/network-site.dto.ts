import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { NetworkSiteKind, NetworkSiteStatus } from '@prisma/client';

export class CreateNetworkSiteDto {
  /** Authority only: which operator the site belongs to. Operators are forced to their own. */
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  siteReference!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsEnum(NetworkSiteKind, { message: 'Choose what kind of site this is.' })
  kind?: NetworkSiteKind;

  @IsOptional()
  @IsEnum(NetworkSiteStatus, { message: 'Choose the site status from the list.' })
  status?: NetworkSiteStatus;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 }, { message: 'Enter a latitude, to at most six decimals.' })
  @Min(-90)
  @Max(90)
  latitude!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 }, { message: 'Enter a longitude, to at most six decimals.' })
  @Min(-180)
  @Max(180)
  longitude!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  technology?: string;

  /** Approximate coverage radius in metres. 200 km is far beyond any terrestrial cell. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(200_000)
  coverageM?: number;

  @IsOptional()
  @IsDateString({}, { message: 'Enter a date.' })
  commissionedAt?: string;
}

export class UpdateNetworkSiteDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  siteReference?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsEnum(NetworkSiteKind, { message: 'Choose what kind of site this is.' })
  kind?: NetworkSiteKind;

  @IsOptional()
  @IsEnum(NetworkSiteStatus, { message: 'Choose the site status from the list.' })
  status?: NetworkSiteStatus;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 }, { message: 'Enter a latitude, to at most six decimals.' })
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 }, { message: 'Enter a longitude, to at most six decimals.' })
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  technology?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(200_000)
  coverageM?: number;

  @IsOptional()
  @IsDateString({}, { message: 'Enter a date.' })
  commissionedAt?: string;
}
