import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Role } from '@prisma/client';

/** Roles an operator-admin may assign within its own entity. */
export const OPERATOR_ASSIGNABLE_ROLES = [Role.OPERATOR_ADMIN, Role.OPERATOR_SUBMITTER] as const;

type OperatorAssignableRole = (typeof OPERATOR_ASSIGNABLE_ROLES)[number];

/**
 * Operator self-service create. The entity is always the caller's own (never
 * supplied here), and the role is restricted to operator roles.
 */
export class OperatorCreateUserDto {
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

  @IsIn(OPERATOR_ASSIGNABLE_ROLES, { message: 'Role must be an operator role' })
  role: OperatorAssignableRole;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password?: string;
}

export class OperatorUpdateUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsIn(OPERATOR_ASSIGNABLE_ROLES, { message: 'Role must be an operator role' })
  role?: OperatorAssignableRole;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
