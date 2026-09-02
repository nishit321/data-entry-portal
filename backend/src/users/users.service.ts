import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { AuditAction, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../common/utils/request-context.util';
import { hashPassword, generateTemporaryPassword } from '../common/utils/password.util';
import { isOperatorRole } from '../common/utils/data-scope.util';
import { paginate, toSkipTake } from '../common/utils/pagination.util';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { OperatorCreateUserDto, OperatorUpdateUserDto } from './dto/operator-user.dto';
import { UserQueryDto } from './dto/user-query.dto';

/** Columns safe to return to clients (never the password hash). */
const publicUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  isActive: true,
  entityId: true,
  // Owning entity's name, so the admin listing can show which operator a user
  // belongs to. Null for Authority/citizen users, who have no entity.
  entity: { select: { name: true } },
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  /** Shared filter/paginate for both the admin and operator listings. */
  private async paginateUsers(query: UserQueryDto, scope: Prisma.UserWhereInput = {}) {
    const where: Prisma.UserWhereInput = {
      ...scope,
      deletedAt: null,
      // Service accounts exist only so a machine credential's filings have an author. They are
      // managed on the API credentials screen and would be nothing but confusion on a team list,
      // where every other row is a person somebody can call.
      isServiceAccount: false,
      role: query.role,
      isActive: query.isActive,
      ...(query.search
        ? {
            OR: [
              { email: { contains: query.search, mode: 'insensitive' } },
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const orderBy = { [query.sort]: query.order } as Prisma.UserOrderByWithRelationInput;
    const { skip, take } = toSkipTake(query);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, select: publicUserSelect, orderBy, skip, take }),
      this.prisma.user.count({ where }),
    ]);
    return paginate(rows, total, query);
  }

  /** Admin listing across all users (paginated). */
  findAll(query: UserQueryDto) {
    return this.paginateUsers(query);
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null, isServiceAccount: false },
      select: publicUserSelect,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /**
   * Keep the role and entity link consistent: operator users must belong to a
   * real (non-deleted) entity; Authority-internal and citizen users must not.
   */
  private async resolveEntityId(role: Role, entityId?: string | null): Promise<string | null> {
    if (isOperatorRole(role)) {
      if (!entityId) {
        throw new BadRequestException('An operator user must be linked to an entity');
      }
      const entity = await this.prisma.entity.findFirst({
        where: { id: entityId, deletedAt: null },
        select: { id: true },
      });
      if (!entity) {
        throw new BadRequestException("That entity doesn't exist.");
      }
      return entityId;
    }
    if (entityId) {
      throw new BadRequestException('Only operator users can be linked to an entity');
    }
    return null;
  }

  /**
   * Guard against locking the Authority out of the portal: the last active
   * administrator may not be demoted to another role or deactivated.
   */
  private async assertAdminAccessRetained(
    before: { id: string; role: Role; isActive: boolean },
    next: { role: Role; isActive: boolean },
  ): Promise<void> {
    const wasActiveAdmin = before.role === Role.ADMIN && before.isActive;
    const staysActiveAdmin = next.role === Role.ADMIN && next.isActive;
    if (!wasActiveAdmin || staysActiveAdmin) return;

    const otherActiveAdmins = await this.prisma.user.count({
      where: { role: Role.ADMIN, isActive: true, deletedAt: null, id: { not: before.id } },
    });
    if (otherActiveAdmins === 0) {
      throw new BadRequestException(
        'Cannot remove admin access from the last active administrator',
      );
    }
  }

  /**
   * Shared creation path used by both admin and operator self-service. The
   * caller is responsible for having already resolved and authorised the role
   * and entityId; this method only persists, emails, and audits.
   */
  private async createUserRecord(
    params: {
      email: string;
      firstName: string;
      lastName: string;
      role: Role;
      entityId: string | null;
      password?: string;
    },
    actorId: string,
    ctx: RequestContext,
  ) {
    const email = params.email.toLowerCase();
    const existing = await this.prisma.user.findFirst({ where: { email, deletedAt: null } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    // Generate a temporary password if the caller did not specify one.
    const usingTempPassword = !params.password;
    const plainPassword = params.password ?? generateTemporaryPassword();

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(plainPassword),
        firstName: params.firstName.trim(),
        lastName: params.lastName.trim(),
        role: params.role,
        entityId: params.entityId,
      },
      select: publicUserSelect,
    });

    await this.mail.sendWelcome(user.email, plainPassword);
    await this.audit.record({
      action: AuditAction.USER_CREATED,
      actorId,
      entityType: 'User',
      entityId: user.id,
      metadata: { role: user.role, entityId: user.entityId },
      context: ctx,
    });

    // Surface the temp password once so the caller can share it if email is off.
    return {
      user,
      temporaryPassword: usingTempPassword ? plainPassword : undefined,
    };
  }

  /** An admin creates a user and assigns any role. */
  async create(dto: CreateUserDto, actorId: string, ctx: RequestContext) {
    const entityId = await this.resolveEntityId(dto.role, dto.entityId);
    return this.createUserRecord(
      {
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: dto.role,
        entityId,
        password: dto.password,
      },
      actorId,
      ctx,
    );
  }

  async update(id: string, dto: UpdateUserDto, actorId: string, ctx: RequestContext) {
    const before = await this.findOne(id);

    // Re-validate the role/entity link when either side changes.
    const nextRole = dto.role ?? before.role;
    const nextActive = dto.isActive ?? before.isActive;
    await this.assertAdminAccessRetained(before, { role: nextRole, isActive: nextActive });

    const nextEntityId = dto.entityId !== undefined ? dto.entityId : (before.entityId ?? undefined);
    const entityId = await this.resolveEntityId(nextRole, nextEntityId);

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        firstName: dto.firstName?.trim(),
        lastName: dto.lastName?.trim(),
        role: dto.role,
        isActive: dto.isActive,
        entityId,
      },
      select: publicUserSelect,
    });

    await this.audit.record({
      action: AuditAction.USER_UPDATED,
      actorId,
      entityType: 'User',
      entityId: id,
      metadata: { before, after: user },
      context: ctx,
    });

    if (dto.isActive !== undefined && dto.isActive !== before.isActive) {
      await this.audit.record({
        action: dto.isActive ? AuditAction.USER_ACTIVATED : AuditAction.USER_DEACTIVATED,
        actorId,
        entityType: 'User',
        entityId: id,
        context: ctx,
      });
    }
    return user;
  }

  async setRole(id: string, role: Role, actorId: string, ctx: RequestContext) {
    const before = await this.findOne(id);
    await this.assertAdminAccessRetained(before, { role, isActive: before.isActive });
    // Moving to a non-operator role clears the entity link; moving to an
    // operator role requires the user to already have a valid entity.
    const entityId = await this.resolveEntityId(role, before.entityId ?? undefined);
    const user = await this.prisma.user.update({
      where: { id },
      data: { role, entityId },
      select: publicUserSelect,
    });
    await this.audit.record({
      action: AuditAction.USER_ROLE_CHANGED,
      actorId,
      entityType: 'User',
      entityId: id,
      metadata: { from: before.role, to: role },
      context: ctx,
    });
    return user;
  }

  /** Prevent self-deletion and removal of the last remaining admin. */
  async remove(id: string, actorId: string, ctx: RequestContext) {
    if (id === actorId) {
      throw new BadRequestException('You cannot delete your own account');
    }
    const user = await this.findOne(id);
    if (user.role === Role.ADMIN) {
      const adminCount = await this.prisma.user.count({
        where: { role: Role.ADMIN, deletedAt: null },
      });
      if (adminCount <= 1) {
        throw new BadRequestException('Cannot delete the last admin account');
      }
    }

    // Soft-delete: retained for audit/retention, excluded from every query. The email is
    // tombstoned so it frees the unique constraint and can be registered again later.
    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), email: tombstoneEmail(user.email, id) },
    });
    await this.audit.record({
      action: AuditAction.USER_DELETED,
      actorId,
      entityType: 'User',
      entityId: id,
      metadata: { email: user.email, role: user.role },
      context: ctx,
    });
    return { message: 'User deleted' };
  }

  /** Assignable roles for the admin UI dropdown. */
  listRoles(): Role[] {
    return Object.values(Role);
  }

  // ==========================================================================
  // Operator self-administration
  //
  // An OPERATOR_ADMIN manages the users of its OWN entity only. Every method
  // below is scoped to the caller's entityId, and roles are limited to operator
  // roles. Cross-entity access and Authority-role assignment are impossible here
  // by construction — the entityId comes from the caller's token, never the body.
  // ==========================================================================

  private requireEntity(entityId: string | null): string {
    if (!entityId) {
      throw new ForbiddenException('Your account is not linked to an entity');
    }
    return entityId;
  }

  /** Reject an action that would leave the entity with no active operator-admin. */
  private async ensureNotLastActiveOperatorAdmin(entityId: string, userId: string) {
    const activeAdmins = await this.prisma.user.count({
      where: { entityId, role: Role.OPERATOR_ADMIN, isActive: true, deletedAt: null },
    });
    const target = await this.prisma.user.findFirst({
      where: { id: userId, entityId, role: Role.OPERATOR_ADMIN, isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (target && activeAdmins <= 1) {
      throw new BadRequestException(
        "You can't remove the last active operator administrator for this entity. Add another one first.",
      );
    }
  }

  /** Operator listing, scoped to the caller's own entity (paginated). */
  listForEntity(entityId: string | null, query: UserQueryDto) {
    return this.paginateUsers(query, { entityId: this.requireEntity(entityId) });
  }

  async findOneInEntity(entityId: string | null, id: string) {
    const user = await this.prisma.user.findFirst({
      // Service accounts are excluded here as well as from the listing. They belong to the
      // operator's entity, so without this an operator admin could reach one by id and edit or
      // delete the account its API credential files as — changing what a machine may do, from a
      // screen that is about people.
      where: {
        id,
        entityId: this.requireEntity(entityId),
        deletedAt: null,
        isServiceAccount: false,
      },
      select: publicUserSelect,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  createForEntity(
    entityId: string | null,
    dto: OperatorCreateUserDto,
    actorId: string,
    ctx: RequestContext,
  ) {
    return this.createUserRecord(
      {
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: dto.role,
        entityId: this.requireEntity(entityId),
        password: dto.password,
      },
      actorId,
      ctx,
    );
  }

  async updateInEntity(
    entityId: string | null,
    id: string,
    dto: OperatorUpdateUserDto,
    actorId: string,
    ctx: RequestContext,
  ) {
    const before = await this.findOneInEntity(entityId, id); // scope + 404

    // Guard the last operator-admin against demotion or deactivation.
    const losingAdmin =
      before.role === Role.OPERATOR_ADMIN &&
      ((dto.role !== undefined && dto.role !== Role.OPERATOR_ADMIN) || dto.isActive === false);
    if (losingAdmin) {
      await this.ensureNotLastActiveOperatorAdmin(before.entityId as string, id);
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        firstName: dto.firstName?.trim(),
        lastName: dto.lastName?.trim(),
        role: dto.role,
        isActive: dto.isActive,
      },
      select: publicUserSelect,
    });

    await this.audit.record({
      action: AuditAction.USER_UPDATED,
      actorId,
      entityType: 'User',
      entityId: id,
      metadata: { before, after: user },
      context: ctx,
    });

    if (dto.isActive !== undefined && dto.isActive !== before.isActive) {
      await this.audit.record({
        action: dto.isActive ? AuditAction.USER_ACTIVATED : AuditAction.USER_DEACTIVATED,
        actorId,
        entityType: 'User',
        entityId: id,
        context: ctx,
      });
    }
    return user;
  }

  async removeFromEntity(
    entityId: string | null,
    id: string,
    actorId: string,
    ctx: RequestContext,
  ) {
    if (id === actorId) {
      throw new BadRequestException('You cannot delete your own account');
    }
    const user = await this.findOneInEntity(entityId, id); // scope + 404
    await this.ensureNotLastActiveOperatorAdmin(user.entityId as string, id);

    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), email: tombstoneEmail(user.email, id) },
    });
    await this.audit.record({
      action: AuditAction.USER_DELETED,
      actorId,
      entityType: 'User',
      entityId: id,
      metadata: { email: user.email, role: user.role, entityId: user.entityId },
      context: ctx,
    });
    return { message: 'User deleted' };
  }
}

/**
 * Rewrite a soft-deleted user's email to a unique tombstone so the original address is released
 * from the `email @unique` constraint and can be registered again. The real address stays in the
 * audit trail.
 */
function tombstoneEmail(email: string, id: string): string {
  return `${email}::deleted::${id}`;
}
