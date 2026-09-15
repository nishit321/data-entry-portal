import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
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
import { NetworkSiteStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/**
 * How many points a route may be drawn with.
 *
 * A fibre run across a country traced off a survey is a few hundred points; a thousand is generous
 * and still small enough that a map of every operator's routes stays a map rather than a download.
 * It is also the guard on an unbounded JSON column: without a cap, one paste of a raw GPS trace
 * would put a megabyte of coordinates in a row that everything else has to read past.
 */
export const MAX_ROUTE_POINTS = 1000;

/** One point on a route, as [latitude, longitude]. */
export type RoutePoint = [number, number];

export class CreateFibreLinkDto {
  /** Authority only: which operator the route belongs to. Operators are forced to their own. */
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  linkReference!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsUUID('4', { message: 'Choose the node this route starts at.' })
  fromSiteId!: string;

  @IsUUID('4', { message: 'Choose the node this route ends at.' })
  toSiteId!: string;

  @IsOptional()
  @IsEnum(NetworkSiteStatus, { message: 'Choose the route status from the list.' })
  status?: NetworkSiteStatus;

  /**
   * Route length in kilometres.
   *
   * Reported rather than calculated, and the two are not the same number: cable follows roads, so
   * a route between nodes 40 km apart is routinely 60 km of fibre. Calculating it from the
   * endpoints would give a figure that is always wrong and always low.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'Enter the route length in kilometres.' })
  @Min(0)
  @Max(20_000)
  lengthKm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  capacityGbps?: number;

  /**
   * The route itself, as an ordered list of [latitude, longitude] pairs.
   *
   * Optional. An operator who has the survey gives it and the map draws the real run; one who has
   * only told us which two nodes are joined gets a straight line, drawn and labelled as an
   * indication. Validated shallowly here — a pair of numbers in range — with the ordering and
   * endpoint checks left to the service, which is where the two sites are already loaded.
   */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2, { message: 'A route needs at least two points.' })
  @ArrayMaxSize(MAX_ROUTE_POINTS, {
    message: `A route can carry up to ${MAX_ROUTE_POINTS} points. Simplify it before uploading.`,
  })
  path?: RoutePoint[];

  @IsOptional()
  @IsDateString({}, { message: 'Enter a date.' })
  commissionedAt?: string;
}

export class UpdateFibreLinkDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  linkReference?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Choose the node this route starts at.' })
  fromSiteId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Choose the node this route ends at.' })
  toSiteId?: string;

  @IsOptional()
  @IsEnum(NetworkSiteStatus, { message: 'Choose the route status from the list.' })
  status?: NetworkSiteStatus;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'Enter the route length in kilometres.' })
  @Min(0)
  @Max(20_000)
  lengthKm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  capacityGbps?: number;

  /** Send an empty array to take a surveyed route off and go back to the straight line. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ROUTE_POINTS, {
    message: `A route can carry up to ${MAX_ROUTE_POINTS} points. Simplify it before uploading.`,
  })
  path?: RoutePoint[];

  @IsOptional()
  @IsDateString({}, { message: 'Enter a date.' })
  commissionedAt?: string;
}

const SORTABLE = ['name', 'linkReference', 'status', 'lengthKm', 'createdAt'] as const;

export class FibreLinkQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @IsOptional()
  @IsEnum(NetworkSiteStatus, { message: 'Choose a status from the list.' })
  status?: NetworkSiteStatus;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsIn(SORTABLE, { message: 'Choose a column to sort by.' })
  sort: (typeof SORTABLE)[number] = 'name';
}
