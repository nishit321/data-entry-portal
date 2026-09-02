import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { ApiClientStatus, ApiScope, AuditAction, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import {
  assertCanAccessEntity,
  entityScopeFilter,
  resolveTargetEntityId,
} from '../common/utils/data-scope.util';
import { hashPassword } from '../common/utils/password.util';
import { isValidCidr, normaliseFingerprint } from './network-controls';
import { CreateApiClientDto, UpdateApiClientDto } from './dto/api-client.dto';

/** Long enough that guessing is hopeless, short enough to paste into a config file. */
const SECRET_BYTES = 32;

/**
 * How long a credential lives unless somebody chooses otherwise.
 *
 * A key with no expiry is a key nobody rotates, and the first time anyone thinks about it is after
 * it has leaked. A year is long enough not to be a nuisance and short enough to be a habit.
 */
const DEFAULT_LIFETIME_DAYS = 365;

const clientSelect = {
  id: true,
  name: true,
  clientId: true,
  secretLast4: true,
  certFingerprint: true,
  allowedCidrs: true,
  scopes: true,
  rateLimitPerMinute: true,
  status: true,
  expiresAt: true,
  lastUsedAt: true,
  revokedAt: true,
  serviceUserId: true,
  createdAt: true,
  entity: { select: { id: true, name: true, type: true } },
} satisfies Prisma.ApiClientSelect;

/**
 * Machine credentials for operator systems (Q10, Phase 3).
 *
 * The secret is generated here, hashed with the same function that hashes a password, and returned
 * to the caller exactly once. Nothing in the portal can show it again — not an administrator, not a
 * database dump, not this service. If it is lost, it is rotated.
 */
@Injectable()
export class ApiClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(user: AuthUser) {
    const scoped = entityScopeFilter(user); // operator -> own id; authority -> undefined
    return this.prisma.apiClient.findMany({
      where: { deletedAt: null, entityId: scoped },
      orderBy: [{ createdAt: 'desc' }],
      select: clientSelect,
    });
  }

  /**
   * Issue a credential. The secret is in the response and nowhere else, ever again.
   */
  async create(user: AuthUser, dto: CreateApiClientDto, ctx: RequestContext) {
    const entityId = resolveTargetEntityId(user, dto.entityId);
    const fingerprint = this.parseFingerprint(dto.certFingerprint);
    const cidrs = this.parseCidrs(dto.allowedCidrs);
    const scopes = this.parseScopes(dto.scopes);

    // Public half is prefixed so a leaked value is recognisable for what it is in a log or a
    // paste, and can be searched for across systems during an incident.
    const clientId = `nca_${randomBytes(12).toString('hex')}`;
    const secret = randomBytes(SECRET_BYTES).toString('base64url');

    // The credential and the account it files as are created together or not at all: a credential
    // whose author row is missing could authenticate and then fail at the moment it tried to file.
    const client = await this.prisma.$transaction(async (tx) => {
      const serviceUser = await tx.user.create({
        data: {
          email: `${clientId}@service.nca.invalid`,
          // No usable password. The hash is of a value nobody holds, and every login path refuses
          // a service account outright regardless — this is belt as well as braces.
          passwordHash: await hashPassword(randomBytes(SECRET_BYTES).toString('base64url')),
          firstName: dto.name.trim().slice(0, 60),
          lastName: '(system)',
          role: Role.OPERATOR_SUBMITTER,
          entityId,
          isServiceAccount: true,
          mfaEnabled: false,
        },
        select: { id: true },
      });

      return tx.apiClient.create({
        data: {
          entityId,
          name: dto.name.trim(),
          clientId,
          secretHash: await hashPassword(secret),
          secretLast4: secret.slice(-4),
          certFingerprint: fingerprint,
          allowedCidrs: cidrs,
          scopes,
          rateLimitPerMinute: dto.rateLimitPerMinute ?? 60,
          expiresAt: this.expiryFrom(dto.expiresAt),
          createdById: user.id,
          serviceUserId: serviceUser.id,
        },
        select: clientSelect,
      });
    });

    await this.record(AuditAction.API_CLIENT_CREATED, client.id, user.id, ctx, {
      entityId,
      scopes,
      hasCertificate: fingerprint !== null,
      restrictedByIp: cidrs.length > 0,
    });

    // The one and only time the secret leaves this method.
    return { ...client, clientSecret: secret };
  }

  async update(user: AuthUser, id: string, dto: UpdateApiClientDto, ctx: RequestContext) {
    const existing = await this.load(id);
    assertCanAccessEntity(user, existing.entityId);
    if (existing.status === ApiClientStatus.REVOKED) {
      throw new BadRequestException('This credential has been revoked and cannot be changed.');
    }

    const client = await this.prisma.apiClient.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        certFingerprint:
          dto.certFingerprint === undefined
            ? undefined
            : this.parseFingerprint(dto.certFingerprint),
        allowedCidrs:
          dto.allowedCidrs === undefined ? undefined : this.parseCidrs(dto.allowedCidrs),
        scopes: dto.scopes === undefined ? undefined : this.parseScopes(dto.scopes),
        rateLimitPerMinute: dto.rateLimitPerMinute,
        // Revoking is its own action; this route may only suspend or restore.
        status:
          dto.status === undefined || dto.status === ApiClientStatus.REVOKED
            ? undefined
            : dto.status,
        expiresAt: dto.expiresAt === undefined ? undefined : this.expiryFrom(dto.expiresAt),
      },
      select: clientSelect,
    });
    await this.record(AuditAction.API_CLIENT_UPDATED, id, user.id, ctx, { changes: { ...dto } });
    return client;
  }

  /**
   * Replace the secret, keeping the same client id.
   *
   * Rotation deliberately does not offer an overlap window where both secrets work. An overlap is
   * convenient during a planned rotation and useless during the one that matters — the rotation
   * you are doing because the old secret leaked.
   */
  async rotateSecret(user: AuthUser, id: string, ctx: RequestContext) {
    const existing = await this.load(id);
    assertCanAccessEntity(user, existing.entityId);
    if (existing.status === ApiClientStatus.REVOKED) {
      throw new BadRequestException('This credential has been revoked. Issue a new one instead.');
    }

    const secret = randomBytes(SECRET_BYTES).toString('base64url');
    const client = await this.prisma.apiClient.update({
      where: { id },
      data: { secretHash: await hashPassword(secret), secretLast4: secret.slice(-4) },
      select: clientSelect,
    });
    // Every signature already in flight was made with the old secret and is now worthless, so the
    // nonces held against them are too.
    await this.prisma.apiNonce.deleteMany({ where: { clientId: id } });

    await this.record(AuditAction.API_CLIENT_SECRET_ROTATED, id, user.id, ctx);
    return { ...client, clientSecret: secret };
  }

  /**
   * Kill a credential for good.
   *
   * Revoked rather than deleted: the audit trail points at this row, and an incident review needs
   * to be able to ask what a credential was allowed to do at the time it was used.
   */
  async revoke(user: AuthUser, id: string, ctx: RequestContext) {
    const existing = await this.load(id);
    assertCanAccessEntity(user, existing.entityId);
    if (existing.status === ApiClientStatus.REVOKED) {
      return { message: 'That credential was already revoked' };
    }

    await this.prisma.$transaction([
      this.prisma.apiClient.update({
        where: { id },
        data: { status: ApiClientStatus.REVOKED, revokedAt: new Date() },
      }),
      // The account it filed as goes quiet with it. The row stays, because ten years of returns
      // point at it and an author that vanishes takes the audit trail with it.
      this.prisma.user.update({
        where: { id: existing.serviceUserId },
        data: { isActive: false },
      }),
      this.prisma.apiNonce.deleteMany({ where: { clientId: id } }),
    ]);
    await this.record(AuditAction.API_CLIENT_REVOKED, id, user.id, ctx);
    return { message: 'Credential revoked' };
  }

  /**
   * Remove spent nonces whose window has closed.
   *
   * A nonce only has to be remembered for as long as a signature made with it could still be
   * accepted. Past that, the row is protecting nothing and is only there to be swept — and a table
   * that only grows is a table that eventually becomes the reason the API is slow.
   */
  async sweepNonces() {
    const { count } = await this.prisma.apiNonce.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return { removed: count };
  }

  private async load(id: string) {
    const existing = await this.prisma.apiClient.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, entityId: true, status: true, serviceUserId: true },
    });
    if (!existing) throw new NotFoundException('That credential does not exist.');
    return existing;
  }

  private parseFingerprint(value: string | undefined): string | null {
    if (value === undefined || value.trim() === '') return null;
    const normalised = normaliseFingerprint(value);
    if (normalised === null) {
      throw new BadRequestException(
        'That is not a SHA-256 certificate fingerprint. It should be 64 hexadecimal characters.',
      );
    }
    return normalised;
  }

  private parseCidrs(values: string[] | undefined): string[] {
    if (!values) return [];
    const cleaned = values.map((v) => v.trim()).filter((v) => v !== '');
    for (const cidr of cleaned) {
      // Checked by shape. Finding a typo now beats finding it when the operator cannot connect.
      if (!isValidCidr(cidr)) {
        throw new BadRequestException(`"${cidr}" is not an address or range we can match against.`);
      }
    }
    return cleaned;
  }

  private parseScopes(scopes: ApiScope[] | undefined): ApiScope[] {
    const unique = [...new Set(scopes ?? [])];
    if (unique.length === 0) {
      throw new BadRequestException('Choose at least one thing this credential may do.');
    }
    return unique;
  }

  private expiryFrom(value: string | undefined): Date {
    if (value) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) throw new BadRequestException('Enter an expiry date.');
      if (date <= new Date()) {
        throw new BadRequestException('The expiry date must be in the future.');
      }
      return date;
    }
    const fallback = new Date();
    fallback.setDate(fallback.getDate() + DEFAULT_LIFETIME_DAYS);
    return fallback;
  }

  private record(
    action: AuditAction,
    clientId: string,
    actorId: string,
    ctx: RequestContext,
    metadata?: Record<string, unknown>,
  ) {
    return this.audit.record({
      action,
      actorId,
      entityType: 'ApiClient',
      entityId: clientId,
      metadata: metadata as Prisma.InputJsonValue,
      context: ctx,
    });
  }
}
