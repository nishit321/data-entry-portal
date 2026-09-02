import { INestApplication, RequestMethod } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { Role } from '@prisma/client';
import { API_PREFIX, API_VERSION, IS_PUBLIC_KEY, ROLES_KEY } from '../constants/app.constants';
import { IS_MACHINE_ROUTE_KEY } from '../../machine-api/machine.decorators';

/**
 * Who may reach a route.
 *
 * The three states matter because two of them are easy to arrive at by accident:
 *
 * - `public` — no authentication at all. Deliberate for sign-in, health and the citizen-facing
 *   pages; a mistake anywhere else, and a silent one.
 * - `roles` — the route names the roles it serves. This is the intended state.
 * - `any-signed-in` — no `@Roles()` at all. `RolesGuard` lets every authenticated user through,
 *   which means an operator submitter at one company can reach it as readily as an NCA approver.
 *   Sometimes that is right (your own notifications). It is never right *by omission*, and
 *   omission looks exactly like intention from the outside.
 */
export type RouteAccess = 'public' | 'roles' | 'any-signed-in';

export interface RouteFact {
  /** `GET /api/v1/submissions/:id` — the path a request actually takes. */
  signature: string;
  method: string;
  path: string;
  controller: string;
  handler: string;
  access: RouteAccess;
  roles: Role[];
  /** Machine-API routes authenticate by client credential, not by user session. */
  machine: boolean;
}

const METHODS: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.ALL]: 'ALL',
  [RequestMethod.OPTIONS]: 'OPTIONS',
  [RequestMethod.HEAD]: 'HEAD',
};

function join(...parts: string[]): string {
  return `/${parts.filter((p) => p && p !== '/').join('/')}`.replace(/\/+/g, '/');
}

/**
 * Every route the application actually serves, read from the running app.
 *
 * From the container rather than from the source, because the source is what someone meant and
 * the container is what is listening. A controller that is registered in two modules, a decorator
 * applied at class level, a route added by a library — a grep sees none of it correctly.
 */
export function inventoryRoutes(app: INestApplication): RouteFact[] {
  const discovery = app.get(DiscoveryService);
  const scanner = app.get(MetadataScanner);
  const reflector = app.get(Reflector);

  const facts: RouteFact[] = [];

  for (const wrapper of discovery.getControllers()) {
    const { instance, metatype } = wrapper;
    if (!instance || !metatype) continue;

    const controllerPath = Reflect.getMetadata(PATH_METADATA, metatype) ?? '';
    const prototype = Object.getPrototypeOf(instance);

    for (const name of scanner.getAllMethodNames(prototype)) {
      const handler = prototype[name];
      const method = Reflect.getMetadata(METHOD_METADATA, handler);
      if (method === undefined) continue;

      const handlerPath = Reflect.getMetadata(PATH_METADATA, handler) ?? '';
      const version =
        Reflect.getMetadata('__version__', handler) ?? Reflect.getMetadata('__version__', metatype);

      // VERSION_NEUTRAL is a symbol; a neutral route carries no version segment.
      const versionSegment =
        typeof version === 'string'
          ? `v${version}`
          : version === undefined
            ? `v${API_VERSION}`
            : '';

      const path = join(API_PREFIX, versionSegment, String(controllerPath), String(handlerPath));

      const isPublic =
        reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, metatype]) ?? false;
      const roles = reflector.getAllAndOverride<Role[]>(ROLES_KEY, [handler, metatype]) ?? [];
      const machine =
        reflector.getAllAndOverride<boolean>(IS_MACHINE_ROUTE_KEY, [handler, metatype]) ?? false;

      const access: RouteAccess = isPublic
        ? 'public'
        : roles.length > 0
          ? 'roles'
          : 'any-signed-in';

      facts.push({
        signature: `${METHODS[method] ?? String(method)} ${path}`,
        method: METHODS[method] ?? String(method),
        path,
        controller: metatype.name,
        handler: name,
        access,
        roles: [...roles].sort(),
        machine,
      });
    }
  }

  return facts.sort((a, b) => a.signature.localeCompare(b.signature));
}
