import { DocumentExpiryStage } from '@prisma/client';
import { DocumentsService } from './documents.service';
import { validateDocument } from './document-validation';

const PDF = Buffer.from('%PDF-1.7\n%test');
const PNG = Buffer.from('89504e470d0a1a0a0000', 'hex');
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);

describe('validateDocument', () => {
  it('accepts a PDF, a PNG, and a JPEG', () => {
    expect(validateDocument('licence.pdf', PDF)).toBeNull();
    expect(validateDocument('scan.png', PNG)).toBeNull();
    expect(validateDocument('scan.jpg', JPG)).toBeNull();
  });

  it('rejects a format the repository does not take', () => {
    expect(validateDocument('data.csv', PDF)).toBe(
      'Documents must be a .pdf, .png, .jpg or .jpeg file.',
    );
  });

  it('rejects a file with no extension, and an empty file', () => {
    expect(validateDocument('licence', PDF)).toMatch(/extension/);
    expect(validateDocument('licence.pdf', Buffer.alloc(0))).toMatch(/empty/);
  });

  it('rejects a file renamed to .pdf that is not a PDF', () => {
    expect(validateDocument('fake.pdf', Buffer.from('hello'))).toMatch(/PDF/);
  });

  it('rejects a file renamed to .png that is not an image', () => {
    expect(validateDocument('fake.png', Buffer.from('hello'))).toMatch(/image/);
  });
});

const DAY = 24 * 60 * 60 * 1000;
const CTX = { ipAddress: '127.0.0.1', userAgent: 'test', requestId: 'r1' };

/** A document expiring `inDays` from now (negative for already expired). */
function doc(id: string, inDays: number, alertedStage: DocumentExpiryStage | null = null) {
  return {
    id,
    entityId: 'ent-1',
    title: `Licence ${id}`,
    expiresAt: new Date(Date.now() + inDays * DAY),
    alertedStage,
  };
}

function buildService(candidates: ReturnType<typeof doc>[]) {
  const prisma = {
    documentRecord: {
      findMany: jest.fn().mockResolvedValue(candidates),
      update: jest.fn().mockResolvedValue({}),
      // The sweep claims a document with a conditional update; `count` is how it learns whether it
      // won the claim or another sweep got there first.
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const notifications = { documentExpiry: jest.fn().mockResolvedValue(undefined) };
  const storage = { save: jest.fn(), stream: jest.fn(), remove: jest.fn(), copy: jest.fn() };
  const config = { get: jest.fn().mockReturnValue({ dir: 'storage', maxFileBytes: 1024 * 1024 }) };
  const service = new DocumentsService(
    prisma as never,
    audit as never,
    notifications as never,
    storage as never,
    config as never,
  );
  return { service, prisma, notifications };
}

describe('DocumentsService.sweepExpiries', () => {
  it('alerts on a document inside the warning window', async () => {
    const { service, notifications } = buildService([doc('a', 30)]);
    const result = await service.sweepExpiries();

    expect(result.alerted).toBe(1);
    expect(notifications.documentExpiry).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'ent-1', expired: false }),
    );
  });

  it('alerts as expired once the date has passed', async () => {
    const { service, notifications } = buildService([doc('a', -3)]);
    await service.sweepExpiries();
    expect(notifications.documentExpiry).toHaveBeenCalledWith(
      expect.objectContaining({ expired: true }),
    );
  });

  it('does not alert twice for the same stage', async () => {
    const { service, notifications } = buildService([doc('a', 30, DocumentExpiryStage.EXPIRING)]);
    const result = await service.sweepExpiries();
    expect(result.alerted).toBe(0);
    expect(notifications.documentExpiry).not.toHaveBeenCalled();
  });

  it('alerts again when a document moves from expiring to expired', async () => {
    const { service, prisma, notifications } = buildService([
      doc('a', -1, DocumentExpiryStage.EXPIRING),
    ]);
    const result = await service.sweepExpiries();
    expect(result.alerted).toBe(1);
    expect(notifications.documentExpiry).toHaveBeenCalledWith(
      expect.objectContaining({ expired: true }),
    );
    // The recorded stage advances, so a further sweep stays quiet.
    expect(prisma.documentRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { alertedStage: DocumentExpiryStage.EXPIRED } }),
    );
  });

  it('sends nothing when another sweep claimed the document first', async () => {
    const { service, prisma, notifications } = buildService([doc('a', 30)]);
    // The conditional update matched no row, which means a concurrent sweep already advanced the
    // stage and has already told the operator.
    prisma.documentRecord.updateMany.mockResolvedValue({ count: 0 });

    const result = await service.sweepExpiries();
    expect(result.alerted).toBe(0);
    expect(notifications.documentExpiry).not.toHaveBeenCalled();
  });

  it('ignores a document still outside the warning window', async () => {
    const { service, notifications } = buildService([doc('a', 400)]);
    const result = await service.sweepExpiries();
    expect(result.alerted).toBe(0);
    expect(notifications.documentExpiry).not.toHaveBeenCalled();
  });
});

describe('DocumentsService.remove', () => {
  it('soft-deletes rather than dropping the row', async () => {
    const { service, prisma } = buildService([]);
    prisma.documentRecord.findFirst.mockResolvedValue({
      id: 'd1',
      entityId: 'ent-1',
      title: 'Licence',
    });
    const admin = { id: 'a', email: 'a@x.ss', role: 'ADMIN', entityId: null } as never;
    await service.remove(admin, 'd1', CTX);
    expect(prisma.documentRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
    );
  });
});
