import { IsEnum, IsIn, IsOptional, IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { TemplateStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { TEMPLATE_SORT_COLUMNS, TemplateSortColumn } from '../templates.constants';

export class CreateTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class UpdateTemplateDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class TemplateQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(TEMPLATE_SORT_COLUMNS)
  sort: TemplateSortColumn = 'updatedAt';

  @IsOptional()
  @IsEnum(TemplateStatus, { message: 'Choose a valid status.' })
  status?: TemplateStatus;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
