import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ComplaintCategory, ComplaintStatus, Role } from '@prisma/client';
import { ComplaintsService } from './complaints.service';
import { hashToken } from '../common/utils/token.util';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { UploadedFile } from '../files/storage.service';

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
    complaintAttachment: {
      create: jest.fn((args: { select: unknown }) => Promise.resolve({ id: 'att1', ...args })),
      findFirst: jest.fn(),
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
  const storage = {
    save: jest.fn().mockResolvedValue('complaints/c1/stored.jpg'),
    stream: jest.fn(),
  };
  // 25 MB is the shipped default for MAX_FILE_MB; the service caps the public route below it.
  const config = {
    get: jest.fn().mockReturnValue({ dir: 'storage', maxFileBytes: 25 * 1024 * 1024 }),
  };
  const service = new ComplaintsService(
    prisma as never,
    audit as never,
    notifications as never,
    storage as never,
    config as never,
  );
  return { service, prisma, audit, notifications, storage };
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
  const stored = (code: string, attachments = 0) => ({
    referenceNumber: 'NCA/CMP/2026/000001',
    status: ComplaintStatus.RECEIVED,
    subject: 'No signal',
    trackingCodeHash: hashToken(code),
    _count: { attachments },
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

  it('says how many files arrived without handing any of them back', async () => {
    const { service } = buildService({
      complaint: { findUnique: jest.fn().mockResolvedValue(stored('right-code', 2)) },
    });
    const result = await service.track({
      referenceNumber: 'NCA/CMP/2026/000001',
      trackingCode: 'right-code',
    });

    // The sender's question is whether their photo arrived. A count answers it; a list of files,
    // or anything that could be turned into one, would make the tracking code a read credential
    // for material the Authority holds on the case.
    expect(result.attachmentCount).toBe(2);
    expect(JSON.stringify(result)).not.toContain('storageKey');
    expect(JSON.stringify(result)).not.toContain('fileName');
  });
});

describe('ComplaintsService.attach', () => {
  /*
   * "Public Complaints: Incorporate an attachment upload option." (NCA, 15 September 2026)
   *
   * The route writes a file to disk for a caller who has not signed in, so what these tests hold
   * is the set of things standing between an anonymous request and the Authority's storage: the
   * credential, the case still being open, a count, a size, a format, and a stored content type
   * that the sender did not choose.
   */
  const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64),
  ]);
  const upload = (over: Partial<UploadedFile> = {}): UploadedFile => ({
    originalname: 'mast.png',
    mimetype: 'image/png',
    size: PNG.length,
    buffer: PNG,
    ...over,
  });
  const onFile = (over: Record<string, unknown> = {}) => ({
    complaint: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'c1',
        referenceNumber: 'NCA/CMP/2026/000001',
        status: ComplaintStatus.RECEIVED,
        trackingCodeHash: hashToken('right-code'),
        _count: { attachments: 0 },
        ...over,
      }),
    },
  });

  it('stores the file and records it against the case', async () => {
    const { service, prisma, storage, audit } = buildService(onFile());
    await service.attach('NCA/CMP/2026/000001', 'right-code', upload(), CTX);

    expect(storage.save).toHaveBeenCalledWith(PNG, 'complaints/c1', 'mast.png');
    const written = (prisma.complaintAttachment.create as jest.Mock).mock.calls[0][0].data;
    expect(written.complaintId).toBe('c1');
    expect(written.storageKey).toBe('complaints/c1/stored.jpg');
    // Nobody signed in, so the entry has no actor — the same footing as the filing itself.
    const entry = (audit.record as jest.Mock).mock.calls[0][0];
    expect(entry.actorId).toBeNull();
    expect(entry.entityId).toBe('NCA/CMP/2026/000001');
  });

  it('stores the type read from the file name, not the one the uploader declared', async () => {
    const { service, prisma } = buildService(onFile());
    // A PNG by name and by its bytes, announced as something a browser would run.
    await service.attach(
      'NCA/CMP/2026/000001',
      'right-code',
      upload({ mimetype: 'text/html' }),
      CTX,
    );

    const written = (prisma.complaintAttachment.create as jest.Mock).mock.calls[0][0].data;
    expect(written.mimeType).toBe('image/png');
  });

  it('refuses the wrong tracking code in the same words as an unknown reference', async () => {
    const wrongCode = buildService(onFile());
    const unknownRef = buildService({
      complaint: { findUnique: jest.fn().mockResolvedValue(null) },
    });

    const a = await wrongCode.service
      .attach('NCA/CMP/2026/000001', 'guessed', upload(), CTX)
      .catch((e: Error) => e.message);
    const b = await unknownRef.service
      .attach('NCA/CMP/2026/999999', 'guessed', upload(), CTX)
      .catch((e: Error) => e.message);

    expect(a).toBe(b);
  });

  it('writes nothing when the code is wrong', async () => {
    const { service, storage, prisma } = buildService(onFile());
    await expect(
      service.attach('NCA/CMP/2026/000001', 'guessed', upload(), CTX),
    ).rejects.toBeInstanceOf(NotFoundException);

    // The credential is checked before a byte reaches disk, not after.
    expect(storage.save).not.toHaveBeenCalled();
    expect(prisma.complaintAttachment.create).not.toHaveBeenCalled();
  });

  it('refuses to add files to a closed case', async () => {
    const { service } = buildService(onFile({ status: ComplaintStatus.CLOSED }));
    await expect(
      service.attach('NCA/CMP/2026/000001', 'right-code', upload(), CTX),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a fourth file', async () => {
    const { service, storage } = buildService(onFile({ _count: { attachments: 3 } }));
    await expect(
      service.attach('NCA/CMP/2026/000001', 'right-code', upload(), CTX),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('caps a public upload below the limit set for licensed operators', async () => {
    /*
     * MAX_FILE_MB is 25 in the fixture, as it is in the shipped configuration. A return filed by a
     * named operator may use all of it; this file arrived with no account behind it, so it may not.
     */
    const { service } = buildService(onFile());
    const oversized = upload({ size: 12 * 1024 * 1024 });

    const message = await service
      .attach('NCA/CMP/2026/000001', 'right-code', oversized, CTX)
      .catch((e: Error) => e.message);
    expect(message).toBe('The file is too large. The maximum size is 10 MB.');
  });

  it('refuses a format a complaint has no use for', async () => {
    const { service } = buildService(onFile());
    const spreadsheet = upload({ originalname: 'figures.xlsx', buffer: Buffer.from('PK') });
    await expect(
      service.attach('NCA/CMP/2026/000001', 'right-code', spreadsheet, CTX),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a file that is a PNG in name only', async () => {
    const { service } = buildService(onFile());
    const renamed = upload({ buffer: Buffer.from('<html><script>alert(1)</script></html>') });
    await expect(
      service.attach('NCA/CMP/2026/000001', 'right-code', renamed, CTX),
    ).rejects.toBeInstanceOf(BadRequestException);
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
