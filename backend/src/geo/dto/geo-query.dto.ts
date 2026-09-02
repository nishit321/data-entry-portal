import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { NetworkSiteKind, NetworkSiteStatus } from '@prisma/client';
import { BooleanQuery } from '../../common/dto/boolean-query.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

const SORTABLE = ['name', 'siteReference', 'kind', 'status', 'createdAt'] as const;

export class NetworkSiteQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @IsOptional()
  @IsEnum(NetworkSiteKind, { message: 'Choose a site type from the list.' })
  kind?: NetworkSiteKind;

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

/** Everything the map draws in one call, so toggling a layer costs no round trip. */
export class MapQueryDto {
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @IsOptional()
  @IsEnum(NetworkSiteKind, { message: 'Choose a site type from the list.' })
  kind?: NetworkSiteKind;

  @IsOptional()
  @IsEnum(NetworkSiteStatus, { message: 'Choose a status from the list.' })
  status?: NetworkSiteStatus;

  /** Agents are on the map unless the caller says otherwise. */
  @BooleanQuery('includeAgents')
  includeAgents?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20_000)
  limit?: number;
}
