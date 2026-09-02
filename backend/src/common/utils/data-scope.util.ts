import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';

/**
 * Central data-segregation rules. Every query that touches operator-owned data
 * scopes through here — never with an ad-hoc `where` clause per endpoint. This
 * is the single place that decides who may see whose data; a leak here would be
 * silent and catastrophic, so it lives in one tested unit.
 */

/** Authority-internal roles with cross-operator visibility. */
export const AUTHORITY_ROLES: readonly Role[] = [
  Role.ADMIN,
  Role.SUPERVISOR,
  Role.ANALYST,
  Role.CHECKER,
  Role.VERIFIER,
  Role.APPROVER,
];

/** External operator roles, scoped strictly to their own entity. */
export const OPERATOR_ROLES: readonly Role[] = [Role.OPERATOR_ADMIN, Role.OPERATOR_SUBMITTER];

/** The caller's identity, as far as scoping is concerned. */
export interface ScopeUser {
  role: Role;
  entityId?: string | null;
}

export function isAuthorityRole(role: Role): boolean {
  return AUTHORITY_ROLES.includes(role);
}

export function isOperatorRole(role: Role): boolean {
  return OPERATOR_ROLES.includes(role);
}

/**
 * The mandatory `entityId` filter for a query over operator-owned data.
 * - Authority roles: no restriction (`undefined` → caller adds no entity filter,
 *   or applies an optional one it was given).
 * - Operator roles: forced to their own `entityId`.
 * - Anyone else (e.g. CITIZEN): denied.
 */
export function entityScopeFilter(user: ScopeUser): string | undefined {
  if (isAuthorityRole(user.role)) return undefined;
  if (isOperatorRole(user.role)) {
    if (!user.entityId) {
      throw new ForbiddenException('Your account is not linked to an entity');
    }
    return user.entityId;
  }
  throw new ForbiddenException("You don't have access to operator records.");
}

/**
 * Resolve which entity a write should target.
 * - Operator: always their own entity; a mismatched requested id is rejected.
 * - Authority: must name the target entity explicitly.
 */
export function resolveTargetEntityId(user: ScopeUser, requestedEntityId?: string): string {
  if (isOperatorRole(user.role)) {
    if (!user.entityId) {
      throw new ForbiddenException('Your account is not linked to an entity');
    }
    if (requestedEntityId && requestedEntityId !== user.entityId) {
      throw new ForbiddenException('You cannot act on behalf of another entity');
    }
    return user.entityId;
  }
  if (isAuthorityRole(user.role)) {
    if (!requestedEntityId) {
      throw new ForbiddenException('Choose an entity first.');
    }
    return requestedEntityId;
  }
  throw new ForbiddenException("You don't have access to operator records.");
}

/** Guard a read/write of a specific record's entity against the caller's scope. */
export function assertCanAccessEntity(user: ScopeUser, entityId: string): void {
  if (isAuthorityRole(user.role)) return;
  if (isOperatorRole(user.role) && user.entityId === entityId) return;
  throw new ForbiddenException("You don't have access to this record.");
}
