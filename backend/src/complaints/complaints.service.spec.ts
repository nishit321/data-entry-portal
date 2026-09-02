import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ComplaintCategory, ComplaintStatus, Role } from '@prisma/client';
import { ComplaintsService } from './complaints.service';
import { hashToken } from '../common/utils/token.util';
import { AuthUser } from '../common/decorators/current-user.decorator';

const CTX = { ipAddress: '127.0.0.1', userAgent: 'test', requestId: 'r1' };
const admin: AuthUser = { id: 'admin', email: 'a@nca.ss', role: Role.ADMIN, entityId: null };

const FILING = {
  category: ComplaintCategory.SERVICE_QUALITY,
  subject: 'No signal for a week',
  description: 'There has been no coverage in my area since last Monday and calls do not connect.',
};

function buildService(over: Record<string, unknown> = {}) {
  const prisma = {
    complaint: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ referenceNumber: 'NCA/CMP/2026/000001' }),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
    entity: { findFirst: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    ...over,
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const notifications = {
    complaintReceived: jest.fn().mockResolvedValue(undefined),
    complaintStatusChanged: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ComplaintsService(prisma as never, audit as never, notifications as never);
  return { service, prisma, audit, notifications };
}

describe('ComplaintsService.file', () => {
  it('mints a reference and a tracking code, storing only the hash', async () => {
    const { service, prisma, notifications } = buildService();
    const result = await service.file(FILING, CTX);

    expect(result.referenceNumber).toBe('NCA/CMP/2026/000001');
    expect(result.trackingCode).toEqual(expect.any(String));
    expect(result.trackingCode.length).toBeGreaterThan(16);

    // The raw code must never be persisted — only its hash.
    const written = (prisma.complaint.create as jest.Mock).mock.calls[0][0].data;
    expect(written.trackingCodeHash).toBe(hashToken(result.trackingCode));
    expect(JSON.stringify(written)).not.toContain(result.trackingCode);

    expect(notifications.complaintReceived).toHaveBeenCalled();
  });

  it('rejects a complaint naming an operator that does not exist', async () => {
    const { service } = buildService({
      entity: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn() },
    });
    await expect(service.file({ ...FILING, aboutEntityId: 'missing' }, CTX)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('files anonymously when no contact details are given', async () => {
    const { service, prisma } = buildService();
    await service.file(FILING, CTX);
    const written = (prisma.complaint.create as jest.Mock).mock.calls[0][0].data;
    expect(written.complainantName).toBeNull();
    expect(written.complainantEmail).toBeNull();
  });
});

describe('ComplaintsService.track', () => {
  const stored = (code: string) => ({
    referenceNumber: 'NCA/CMP/2026/000001',
    status: ComplaintStatus.RECEIVED,
    subject: 'No signal',
    trackingCodeHash: hashToken(code),
  });

  it('returns the complaint when the reference and code both match', async () => {
    const { service } = buildService({
      complaint: { findUnique: jest.fn().mockResolvedValue(stored('right-code')) },
    });
    const result = await service.track({
      referenceNumber: 'NCA/CMP/2026/000001',
      trackingCode: 'right-code',
    });
    expect(result.referenceNumber).toBe('NCA/CMP/2026/000001');
    // The hash must not travel back out to the caller.
    expect((result as Record<string, unknown>).trackingCodeHash).toBeUndefined();
  });

  it('refuses a correct reference with the wrong tracking code', async () => {
    const { service } = buildService({
      complaint: { findUnique: jest.fn().mockResolvedValue(stored('right-code')) },
    });
    await expect(
      service.track({ referenceNumber: 'NCA/CMP/2026/000001', trackingCode: 'guessed' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('gives the same answer for a wrong code and an unknown reference', async () => {
    const wrongCode = buildService({
      complaint: { findUnique: jest.fn().mockResolvedValue(stored('right-code')) },
    });
    const unknownRef = buildService({
      complaint: { findUnique: jest.fn().mockResolvedValue(null) },
    });

    const a = await wrongCode.service
      .track({ referenceNumber: 'NCA/CMP/2026/000001', trackingCode: 'guessed' })
      .catch((e: Error) => e.message);
    const b = await unknownRef.service
      .track({ referenceNumber: 'NCA/CMP/2026/999999', trackingCode: 'guessed' })
      .catch((e: Error) => e.message);

    // Identical wording, so the endpoint cannot be used to discover which references exist.
    expect(a).toBe(b);
  });
});

describe('ComplaintsService.updateStatus', () => {
  it('stamps resolvedAt when a case reaches a terminal status', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'c1' });
    const { service } = buildService({
      complaint: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'c1',
          status: ComplaintStatus.IN_REVIEW,
          referenceNumber: 'NCA/CMP/2026/000001',
          complainantEmail: 'citizen@example.test',
        }),
        update,
      },
    });
    await service.updateStatus(admin, 'c1', { status: ComplaintStatus.RESOLVED }, CTX);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ComplaintStatus.RESOLVED,
          resolvedAt: expect.any(Date),
          handledById: 'admin',
        }),
      }),
    );
  });

  it('clears resolvedAt when a case is reopened for more work', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'c1' });
    const { service } = buildService({
      complaint: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'c1',
          status: ComplaintStatus.RESOLVED,
          referenceNumber: 'NCA/CMP/2026/000001',
          complainantEmail: 'citizen@example.test',
        }),
        update,
      },
    });
    await service.updateStatus(admin, 'c1', { status: ComplaintStatus.IN_REVIEW }, CTX);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ resolvedAt: null }) }),
    );
  });

  it('tells the citizen when their complaint moves on', async () => {
    const { service, notifications } = buildService({
      complaint: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'c1',
          status: ComplaintStatus.IN_REVIEW,
          referenceNumber: 'NCA/CMP/2026/000001',
          complainantEmail: 'citizen@example.test',
        }),
        update: jest.fn().mockResolvedValue({ id: 'c1' }),
      },
    });
    await service.updateStatus(
      admin,
      'c1',
      { status: ComplaintStatus.RESOLVED, resolutionNote: 'The mast has been repaired.' },
      CTX,
    );
    // Worded for someone who has never seen the enum, and carrying the Authority's note.
    expect(notifications.complaintStatusChanged).toHaveBeenCalledWith({
      email: 'citizen@example.test',
      referenceNumber: 'NCA/CMP/2026/000001',
      statusLabel: 'resolved',
      note: 'The mast has been repaired.',
    });
  });

  it('refuses a no-op status change', async () => {
    const { service } = buildService({
      complaint: {
        findUnique: jest.fn().mockResolvedValue({ id: 'c1', status: ComplaintStatus.IN_REVIEW }),
        update: jest.fn(),
      },
    });
    await expect(
      service.updateStatus(admin, 'c1', { status: ComplaintStatus.IN_REVIEW }, CTX),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
