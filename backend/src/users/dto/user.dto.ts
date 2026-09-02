import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Role } from '@prisma/client';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName: string;

  @IsEnum(Role, { message: 'Choose a role from the list.' })
  role: Role;

  // The entity an operator user belongs to. Required for operator roles,
  // must be omitted for Authority/citizen roles (enforced in the service).
  @IsOptional()
  @IsUUID()
  entityId?: string;

  // Optional: if omitted, the API generates a temporary password.
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password?: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsEnum(Role, { message: 'Choose a role from the list.' })
  role?: Role;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsUUID()
  entityId?: string;
}

export class UpdateRoleDto {
  @IsEnum(Role, { message: 'Choose a role from the list.' })
  role: Role;
}
