import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../constants/app.constants';

/**
 * Marks a route as publicly accessible, bypassing the global JwtAuthGuard.
 * Used for signup, login, password reset, and health checks.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
