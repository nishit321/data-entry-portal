import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma, SignatureFormat, SigningCertificateStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import { assertCanAccessEntity } from '../common/utils/data-scope.util';
import {
  CertificateError,
  VERIFICATION_MESSAGES,
  readCertificate,
  submissionDigest,
  verifySubmissionSignature,
  type SignatureAlgorithm,
} from './submission-digest';
import { RegisterCertificateDto } from './dto/signature.dto';

const certificateSelect = {
  id: true,
  label: true,
  fingerprint: true,
  subject: true,
  issuer: true,
  algorithm: true,
  notBefore: true,
  notAfter: true,
  selfSigned: true,
  status: true,
  revokedAt: true,
  createdAt: true,
  user: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.SigningCertificateSelect;

/**
 * Certificate-based signatures (Q6, Phase 3).
 *
 * Two jobs: hold the certificates people sign with, and check the signatures they produce.
 *
 * Only public halves are ever stored. That is the whole basis of the thing — a signature the portal
 * could have produced itself proves nothing about who made it, so the private key must never be
 * here, and there is deliberately no endpoint that would accept one.
 */
@Injectable()
export class SignaturesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** A user's own certificates. */
  listMine(user: AuthUser) {
    return this.prisma.signingCertificate.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: certificateSelect,
    });
  }

  async register(user: AuthUser, dto: RegisterCertificateDto, ctx: RequestContext) {
    let facts;
    try {
      facts = readCertificate(dto.certificatePem);
    } catch (error) {
      throw new BadRequestException(
        error instanceof CertificateError ? error.message : 'That certificate could not be read.',
      );
    }

    const now = new Date();
    if (facts.notAfter <= now) {
      throw new BadRequestException('That certificate has already expired.');
    }
    if (facts.notBefore > now) {
      throw new BadRequestException('That certificate is not valid yet.');
    }

    // A fingerprint is globally unique, so the same certificate cannot be registered twice —
    // including by two different people, which would make "who signed this?" ambiguous.
    const clash = await this.prisma.signingCertificate.findUnique({
      where: { fingerprint: facts.fingerprint },
      select: { userId: true },
    });
    if (clash) {
      throw new BadRequestException(
        clash.userId === user.id
          ? 'You have already registered that certificate.'
          : 'That certificate is already registered to someone else.',
      );
    }

    const certificate = await this.prisma.signingCertificate.create({
      data: {
        userId: user.id,
        label: dto.label.trim(),
        fingerprint: facts.fingerprint,
        subject: facts.subject,
        issuer: facts.issuer,
        publicKeyPem: facts.publicKeyPem,
        certificatePem: dto.certificatePem.trim(),
        algorithm: facts.algorithm,
        notBefore: facts.notBefore,
        notAfter: facts.notAfter,
        selfSigned: facts.selfSigned,
      },
      select: certificateSelect,
    });

    await this.record(AuditAction.SIGNING_CERTIFICATE_REGISTERED, certificate.id, user.id, ctx, {
      fingerprint: facts.fingerprint,
      selfSigned: facts.selfSigned,
    });
    return certificate;
  }

  /**
   * Retire a certificate.
   *
   * Revoked, never deleted. Returns signed with it point at this row, and a signature whose
   * certificate has vanished can never be checked again, which would quietly undo the only thing a
   * PKI signature was there to provide.
   */
  async revoke(user: AuthUser, id: string, ctx: RequestContext) {
    const existing = await this.prisma.signingCertificate.findUnique({
      where: { id },
      select: { id: true, userId: true, status: true },
    });
    if (!existing || existing.userId !== user.id) {
      throw new NotFoundException('That certificate is not registered to you.');
    }
    if (existing.status === SigningCertificateStatus.REVOKED) {
      return { message: 'That certificate was already revoked' };
    }

    await this.prisma.signingCertificate.update({
      where: { id },
      data: { status: SigningCertificateStatus.REVOKED, revokedAt: new Date() },
    });
    await this.record(AuditAction.SIGNING_CERTIFICATE_REVOKED, id, user.id, ctx);
    return { message: 'Certificate revoked' };
  }

  /**
   * The digest of a return as it stands right now.
   *
   * Given to a signer before they sign, and recomputed on the way in to check what they signed.
   * Exposed as its own endpoint so an operator's system can compute it independently and compare:
   * a signature scheme nobody can reproduce is a signature scheme nobody will trust.
   */
  async digestFor(user: AuthUser, submissionId: string) {
    const submission = await this.loadForDigest(submissionId);
    assertCanAccessEntity(user, submission.entityId);
    return {
      submissionId,
      digest: this.digestOf(submission),
      version: submission.version,
    };
  }

  /**
   * Check the signature recorded against a return, now.
   *
   * Re-run at any time, by anyone allowed to see the return. That is what non-repudiation means in
   * practice: not that a signature was checked once on the way in, but that it can be checked again
   * whenever somebody has reason to doubt it.
   */
  async verify(user: AuthUser, submissionId: string, ctx: RequestContext) {
    const submission = await this.loadForDigest(submissionId);
    assertCanAccessEntity(user, submission.entityId);

    if (submission.signatureFormat !== SignatureFormat.PKI || !submission.signatureValue) {
      return {
        submissionId,
        format: submission.signatureFormat,
        signed: submission.signedAt !== null,
        verified: null,
        message:
          submission.signedAt === null
            ? 'This return has not been signed.'
            : 'This return carries a simple electronic signature, so there is no certificate to check it against.',
      };
    }

    const certificate = submission.signatureCert;
    if (!certificate) {
      return {
        submissionId,
        format: submission.signatureFormat,
        signed: true,
        verified: false,
        message: 'The certificate this return was signed with is no longer on file.',
      };
    }

    const currentDigest = this.digestOf(submission);
    const result = verifySubmissionSignature({
      publicKeyPem: certificate.publicKeyPem,
      algorithm: certificate.algorithm as SignatureAlgorithm,
      signedDigest: submission.signatureDigest ?? '',
      currentDigest,
      signature: submission.signatureValue,
    });

    await this.record(AuditAction.SUBMISSION_SIGNATURE_VERIFIED, submissionId, user.id, ctx, {
      verified: result.ok,
      reason: result.reason,
    });

    return {
      submissionId,
      format: submission.signatureFormat,
      signed: true,
      verified: result.ok,
      message: result.ok
        ? 'The signature is valid and the return has not changed since it was signed.'
        : VERIFICATION_MESSAGES[result.reason!],
      certificate: {
        subject: certificate.subject,
        issuer: certificate.issuer,
        fingerprint: certificate.fingerprint,
        // Reported rather than acted on: a signature made while a certificate was valid stays
        // valid afterwards. That the certificate has since expired or been revoked is a fact the
        // reader needs, not grounds for the portal to overrule the arithmetic.
        expired: certificate.notAfter <= new Date(),
        revoked: certificate.status === SigningCertificateStatus.REVOKED,
      },
    };
  }

  /**
   * The certificate a signer may use right now, checked at the moment of signing.
   *
   * Validity is enforced here and only here. Once a return is signed, later expiry or revocation
   * does not retrospectively unsign it. It is recorded and shown, which is how a paper signature
   * works too.
   */
  async resolveSigningCertificate(userId: string, certificateId: string) {
    const certificate = await this.prisma.signingCertificate.findUnique({
      where: { id: certificateId },
      select: {
        id: true,
        userId: true,
        status: true,
        notBefore: true,
        notAfter: true,
        publicKeyPem: true,
        algorithm: true,
      },
    });
    if (!certificate || certificate.userId !== userId) {
      throw new BadRequestException('That certificate is not registered to you.');
    }
    if (certificate.status === SigningCertificateStatus.REVOKED) {
      throw new BadRequestException('That certificate has been revoked.');
    }
    const now = new Date();
    if (certificate.notAfter <= now || certificate.notBefore > now) {
      throw new BadRequestException('That certificate is not valid today.');
    }
    return certificate;
  }

  /** The canonical digest of a loaded return. */
  digestOf(submission: {
    entityId: string;
    periodId: string;
    templateId: string;
    version: number;
    values: { valueText: string | null; field: { key: string } }[];
  }): string {
    return submissionDigest({
      entityId: submission.entityId,
      periodId: submission.periodId,
      templateId: submission.templateId,
      version: submission.version,
      values: submission.values.map((v) => ({ fieldKey: v.field.key, value: v.valueText ?? '' })),
    });
  }

  private async loadForDigest(id: string) {
    const submission = await this.prisma.submission.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        entityId: true,
        periodId: true,
        templateId: true,
        version: true,
        signedAt: true,
        signatureFormat: true,
        signatureDigest: true,
        signatureValue: true,
        signatureCert: {
          select: {
            publicKeyPem: true,
            algorithm: true,
            subject: true,
            issuer: true,
            fingerprint: true,
            notAfter: true,
            status: true,
          },
        },
        values: {
          where: { isUnavailable: false },
          select: { valueText: true, field: { select: { key: true } } },
        },
      },
    });
    if (!submission) throw new NotFoundException('That return does not exist.');
    return submission;
  }

  private record(
    action: AuditAction,
    entityId: string,
    actorId: string,
    ctx: RequestContext,
    metadata?: Record<string, unknown>,
  ) {
    return this.audit.record({
      action,
      actorId,
      entityType: 'SigningCertificate',
      entityId,
      metadata: metadata as Prisma.InputJsonValue,
      context: ctx,
    });
  }
}
