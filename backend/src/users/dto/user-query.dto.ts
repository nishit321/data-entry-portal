import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Role } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export const USER_SORT_COLUMNS = [
  'createdAt',
  'email',
  'firstName',
  'lastName',
  'role',
  'isActive',
] as const;
export type UserSortColumn = (typeof USER_SORT_COLUMNS)[number];

export class UserQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(USER_SORT_COLUMNS)
  sort: UserSortColumn = 'createdAt';

  @IsOptional()
  @IsEnum(Role, { message: 'Choose a role from the list.' })
  role?: Role;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : value === 'true' || value === true))
  @IsBoolean()
  isActive?: boolean;

  /** Free-text search over email, first name and last name. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
