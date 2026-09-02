import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../constants/app.constants';

/**
 * Restrict a route (or controller) to one or more roles.
 * Enforced by RolesGuard. With no argument, any authenticated user passes.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
