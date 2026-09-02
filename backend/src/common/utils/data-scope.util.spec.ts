import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import {
  assertCanAccessEntity,
  entityScopeFilter,
  isAuthorityRole,
  isOperatorRole,
  resolveTargetEntityId,
} from './data-scope.util';

const ENTITY_A = '11111111-1111-1111-1111-111111111111';
const ENTITY_B = '22222222-2222-2222-2222-222222222222';

const authority = (role: Role) => ({ role, entityId: null });
const operator = (entityId: string | null) => ({ role: Role.OPERATOR_ADMIN, entityId });

describe('data-scope.util', () => {
  describe('role classification', () => {
    it.each([
      Role.ADMIN,
      Role.SUPERVISOR,
      Role.ANALYST,
      Role.CHECKER,
      Role.VERIFIER,
      Role.APPROVER,
    ])('treats %s as an Authority role', (role) => {
      expect(isAuthorityRole(role)).toBe(true);
      expect(isOperatorRole(role)).toBe(false);
    });

    it.each([Role.OPERATOR_ADMIN, Role.OPERATOR_SUBMITTER])(
      'treats %s as an operator role',
      (role) => {
        expect(isOperatorRole(role)).toBe(true);
        expect(isAuthorityRole(role)).toBe(false);
      },
    );

    it('treats CITIZEN as neither', () => {
      expect(isAuthorityRole(Role.CITIZEN)).toBe(false);
      expect(isOperatorRole(Role.CITIZEN)).toBe(false);
    });
  });

  describe('entityScopeFilter', () => {
    it('does not restrict Authority users', () => {
      expect(entityScopeFilter(authority(Role.ANALYST))).toBeUndefined();
    });

    it('forces an operator to their own entity', () => {
      expect(entityScopeFilter(operator(ENTITY_A))).toBe(ENTITY_A);
    });

    it('rejects an operator with no entity link', () => {
      expect(() => entityScopeFilter(operator(null))).toThrow(ForbiddenException);
    });

    it('denies anyone else (e.g. CITIZEN)', () => {
      expect(() => entityScopeFilter({ role: Role.CITIZEN, entityId: null })).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('resolveTargetEntityId', () => {
    it('forces an operator to their own entity, ignoring an absent request', () => {
      expect(resolveTargetEntityId(operator(ENTITY_A))).toBe(ENTITY_A);
    });

    it('allows an operator to name their own entity explicitly', () => {
      expect(resolveTargetEntityId(operator(ENTITY_A), ENTITY_A)).toBe(ENTITY_A);
    });

    it('forbids an operator naming a different entity', () => {
      expect(() => resolveTargetEntityId(operator(ENTITY_A), ENTITY_B)).toThrow(ForbiddenException);
    });

    it('requires Authority to name a target entity', () => {
      expect(() => resolveTargetEntityId(authority(Role.ADMIN))).toThrow(ForbiddenException);
      expect(resolveTargetEntityId(authority(Role.ADMIN), ENTITY_B)).toBe(ENTITY_B);
    });
  });

  describe('assertCanAccessEntity', () => {
    it('lets Authority reach any entity', () => {
      expect(() => assertCanAccessEntity(authority(Role.VERIFIER), ENTITY_B)).not.toThrow();
    });

    it('lets an operator reach only its own entity', () => {
      expect(() => assertCanAccessEntity(operator(ENTITY_A), ENTITY_A)).not.toThrow();
      expect(() => assertCanAccessEntity(operator(ENTITY_A), ENTITY_B)).toThrow(ForbiddenException);
    });
  });
});
