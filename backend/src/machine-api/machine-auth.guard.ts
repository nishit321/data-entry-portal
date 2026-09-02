import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ApiClientStatus, ApiScope, AuditAction, Prisma } from '@prisma/client';
import type { Request } from 'express';
import type { TLSSocket } from 'tls';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { verifyPassword } from '../common/utils/password.util';
import { getRequestContext } from '../common/utils/request-context.util';
import { API_SCOPES_KEY } from './machine.decorators';
import {
  certificateMatches,
  ipAllowed,
  normaliseFingerprint,
  normaliseIp,
} from './network-controls';
import {
  SIGNATURE_HEADERS,
  SIGNATURE_MESSAGES,
  verifySignature,
  type SignatureFailure,
} from './request-signing';
import { MachineApiConfig } from '../config/configuration';

/** What a machine request carries once it has been authenticated. */
export interface MachineCaller {
  id: string;
  clientId: string;
  entityId: string;
  scopes: ApiScope[];
  name: string;
}

/** A request that has been through this guard. */
export interface MachineRequest extends Request {
  machine?: MachineCaller;
  /** Captured by the raw-body middleware, because a signature is over bytes, not over a parsed object. */
  rawBody?: string;
}

/** Per-credential request counters, held in memory and swept as they age out. */
interface RateWindow {
  count: number;
  resetAt: number;
}

/**
 * Authenticates and authorises a machine request (Q10, Phase 3).
 *
 * Every control Q10 asks for is checked here, in this order, and the order is deliberate — the
 * cheap checks that need no secrets come first, so an unauthenticated flood is refused before it
 * costs a bcrypt comparison:
 *
 *  1. The credential exists, is active, and has not expired.
 *  2. The caller's address is on the credential's allow-list.
 *  3. The client certificate is the one the credential is bound to (mutual TLS).
 *  4. The per-credential rate limit has not been passed.
 *  5. The secret matches.
 *  6. The request signature matches the body, method and path, inside the time window.
 *  7. The nonce has not been used before.
 *  8. The credential holds the scope this route requires.
 *
 * Every outcome, accepted or refused, is written to the audit trail: Q10 asks for full audit
 * logging, and a refused request is the more interesting half of that.
 */
@Injectable()
export class MachineAuthGuard implements CanActivate {
  private readonly logger = new Logger(MachineAuthGuard.name);
  private readonly rates = new Map<string, RateWindow>();
  private readonly config: MachineApiConfig;

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    configService: ConfigService,
  ) {
    this.config = configService.get<MachineApiConfig>('machineApi')!;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<MachineRequest>();
    const required = this.reflector.getAllAndOverride<ApiScope[]>(API_SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const clientId = this.header(request, 'x-nca-client-id');
    const secret = this.header(request, 'x-nca-client-secret');
    if (!clientId || !secret) {
      await this.refuse(request, null, 'NO_CREDENTIALS');
      throw new UnauthorizedException('Send a client id and secret with this request.');
    }

    const client = await this.prisma.apiClient.findFirst({
      where: { clientId, deletedAt: null },
      select: {
        id: true,
        name: true,
        clientId: true,
        entityId: true,
        secretHash: true,
        certFingerprint: true,
        allowedCidrs: true,
        scopes: true,
        rateLimitPerMinute: true,
        status: true,
        expiresAt: true,
        entity: { select: { status: true, deletedAt: true } },
      },
    });

    // 1. The credential itself.
    if (!client) {
      await this.refuse(request, null, 'UNKNOWN_CLIENT', { clientId });
      // Deliberately the same message as a bad secret: which of the two was wrong is not
      // information an unauthenticated caller has any business learning.
      throw new UnauthorizedException('Those credentials were not recognised.');
    }
    if (client.status !== ApiClientStatus.ACTIVE) {
      await this.refuse(request, client.id, 'CLIENT_NOT_ACTIVE', { status: client.status });
      throw new UnauthorizedException('This credential is no longer active.');
    }
    if (client.expiresAt && client.expiresAt <= new Date()) {
      await this.refuse(request, client.id, 'CLIENT_EXPIRED');
      throw new UnauthorizedException('This credential has expired. Ask for a new one.');
    }
    // An operator that has been suspended or removed cannot file through the API either. Without
    // this, a machine credential would quietly outlive the account it belongs to.
    if (client.entity.deletedAt !== null || client.entity.status !== 'ACTIVE') {
      await this.refuse(request, client.id, 'ENTITY_NOT_ACTIVE');
      throw new ForbiddenException('This operator is not currently able to file.');
    }

    // 2. Where the request came from.
    const ip = normaliseIp(request.ip ?? '');
    if (!ipAllowed(ip, client.allowedCidrs)) {
      await this.refuse(request, client.id, 'IP_NOT_ALLOWED', { ip });
      throw new ForbiddenException('This credential cannot be used from this address.');
    }

    // 3. Mutual TLS.
    if (!certificateMatches(client.certFingerprint, this.presentedCertificate(request))) {
      await this.refuse(request, client.id, 'CERTIFICATE_MISMATCH');
      throw new ForbiddenException(
        'This request did not present the client certificate this credential is bound to.',
      );
    }

    // 4. Rate limit, per credential.
    if (!this.withinRate(client.id, client.rateLimitPerMinute)) {
      await this.refuse(request, client.id, 'RATE_LIMITED');
      throw new ForbiddenException('Too many requests. Slow down and try again shortly.');
    }

    // 5. The secret.
    if (!(await verifyPassword(secret, client.secretHash))) {
      await this.refuse(request, client.id, 'BAD_SECRET');
      throw new UnauthorizedException('Those credentials were not recognised.');
    }

    // 6. The signature.
    const verified = verifySignature(
      secret,
      {
        timestamp: this.header(request, SIGNATURE_HEADERS.timestamp),
        nonce: this.header(request, SIGNATURE_HEADERS.nonce),
        signature: this.header(request, SIGNATURE_HEADERS.signature),
        method: request.method,
        path: request.path,
        body: request.rawBody ?? '',
      },
      new Date(),
    );
    if (!verified.ok) {
      await this.refuse(request, client.id, `SIGNATURE_${verified.reason}`);
      throw new UnauthorizedException(SIGNATURE_MESSAGES[verified.reason as SignatureFailure]);
    }

    // 7. Single use. The unique index is the guard, not the lookup: two identical requests racing
    // each other both pass every check above, and the second one has to lose the insert.
    const nonce = this.header(request, SIGNATURE_HEADERS.nonce)!;
    try {
      await this.prisma.apiNonce.create({
        data: { clientId: client.id, nonce, expiresAt: verified.nonceExpiresAt! },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        await this.refuse(request, client.id, 'REPLAYED_NONCE');
        throw new UnauthorizedException('This request has already been received.');
      }
      throw error;
    }

    // 8. Scope.
    if (required?.length && !required.some((scope) => client.scopes.includes(scope))) {
      await this.refuse(request, client.id, 'MISSING_SCOPE', { required });
      throw new ForbiddenException('This credential is not allowed to do that.');
    }

    request.machine = {
      id: client.id,
      clientId: client.clientId,
      entityId: client.entityId,
      scopes: client.scopes,
      name: client.name,
    };

    // Best-effort: a failure to stamp the last-used time must not fail an otherwise good request.
    void this.prisma.apiClient
      .update({ where: { id: client.id }, data: { lastUsedAt: new Date() } })
      .catch((err: unknown) =>
        this.logger.warn(`Could not stamp ${client.clientId}: ${String(err)}`),
      );

    await this.audit
      .record({
        action: AuditAction.API_REQUEST_ACCEPTED,
        actorId: null,
        entityType: 'ApiClient',
        entityId: client.id,
        metadata: { method: request.method, path: request.path, ip } as Prisma.InputJsonValue,
        context: getRequestContext(request),
      })
      .catch(() => undefined);

    return true;
  }

  /**
   * The fingerprint of the certificate the caller presented.
   *
   * Two ways in, because NCA may run this behind a TLS-terminating proxy or terminate TLS in the
   * application (Q5: on-premise, cloud, or hybrid). The proxy header is honoured **only** when a
   * trusted-proxy header name has been configured — an unconditional header read would let anyone
   * claim any certificate simply by setting it.
   */
  private presentedCertificate(request: MachineRequest): string | null {
    const socket = request.socket as TLSSocket;
    if (typeof socket?.getPeerCertificate === 'function') {
      const cert = socket.getPeerCertificate();
      if (cert && cert.raw) {
        return createHash('sha256').update(cert.raw).digest('hex');
      }
      // Some stacks give the fingerprint directly rather than the DER bytes.
      const direct = (cert as { fingerprint256?: string })?.fingerprint256;
      if (direct) return normaliseFingerprint(direct);
    }

    const headerName = this.config.clientCertHeader;
    if (headerName) {
      return normaliseFingerprint(this.header(request, headerName.toLowerCase()));
    }
    return null;
  }

  /**
   * A fixed window per credential, held in memory.
   *
   * In memory rather than in the database because a rate limit that costs a write per request is
   * a rate limit that makes the flood worse. Across several instances each holds its own window,
   * so the effective limit multiplies by the instance count — documented rather than hidden, and
   * the global throttler still sits in front of everything.
   */
  private withinRate(clientId: string, limitPerMinute: number): boolean {
    const now = Date.now();
    const window = this.rates.get(clientId);

    if (!window || window.resetAt <= now) {
      this.rates.set(clientId, { count: 1, resetAt: now + 60_000 });
      // Sweep anything long finished, so a process that has seen many credentials does not hold
      // a counter for every one of them for the rest of its life.
      if (this.rates.size > 1000) {
        for (const [key, value] of this.rates) if (value.resetAt <= now) this.rates.delete(key);
      }
      return true;
    }

    window.count += 1;
    return window.count <= limitPerMinute;
  }

  private header(request: Request, name: string): string | undefined {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }

  /** Record a refusal, then let the caller throw. A refusal that is not written down is not a control. */
  private async refuse(
    request: MachineRequest,
    clientRowId: string | null,
    reason: string,
    metadata: Record<string, unknown> = {},
  ) {
    await this.audit
      .record({
        action: AuditAction.API_REQUEST_REFUSED,
        actorId: null,
        entityType: 'ApiClient',
        entityId: clientRowId ?? 'unknown',
        metadata: {
          reason,
          method: request.method,
          path: request.path,
          ip: normaliseIp(request.ip ?? ''),
          ...metadata,
        } as Prisma.InputJsonValue,
        context: getRequestContext(request),
      })
      .catch((err: unknown) => this.logger.warn(`Could not audit a refusal: ${String(err)}`));
    this.logger.warn(`Machine request refused (${reason}) on ${request.method} ${request.path}`);
  }
}
