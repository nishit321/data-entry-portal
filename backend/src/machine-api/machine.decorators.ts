import { SetMetadata } from '@nestjs/common';
import { ApiScope } from '@prisma/client';

/** Metadata key naming the scopes a machine route requires. */
export const API_SCOPES_KEY = 'machine:scopes';

/**
 * The scopes a machine route needs. Holding any one of them is enough, which keeps a route that
 * serves two purposes from forcing an operator to hold both.
 */
export const RequireScopes = (...scopes: ApiScope[]) => SetMetadata(API_SCOPES_KEY, scopes);

/** Metadata key marking a route as machine-authenticated rather than user-authenticated. */
export const IS_MACHINE_ROUTE_KEY = 'machine:route';

/**
 * Marks a route as belonging to the machine API.
 *
 * The global JWT guard lets these through — they carry credentials of a different kind — and
 * `MachineAuthGuard` does the real work. It is a separate marker from `@Public()` on purpose:
 * these routes are emphatically not public, and reading `@Public()` on them later would give
 * exactly the wrong impression.
 */
export const MachineRoute = () => SetMetadata(IS_MACHINE_ROUTE_KEY, true);
