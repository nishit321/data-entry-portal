import { NotificationDeliveryStatus, ReviewStage, Role } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { NotificationChannel } from './channels';
import { AuthUser } from '../common/decorators/current-user.decorator';

const mail = { sendNotification: jest.fn().mockResolvedValue(undefined) };

const RECIPIENT = { id: 'op1', email: 'op@x.ss', firstName: 'Op', lastName: 'One' };

function buildPrisma() {
  return {
    user: { findMany: jest.fn().mockResolvedValue([RECIPIENT]) },
    notification: {
      create: jest.fn().mockResolvedValue({ id: 'n1' }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn().mockResolvedValue({ id: 'n1' }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
}

/** An email channel whose send fails the first `failTimes` calls, then succeeds. */
function emailChannel(failTimes: number): NotificationChannel & { calls: number } {
  return {
    name: 'email',
    calls: 0,
    isEnabled: () => true,
    async send() {
      this.calls += 1;
      if (this.calls <= failTimes) throw new Error('transient');
    },
  };
}

const user = (id: string): AuthUser => ({
  id,
  email: `${id}@x.ss`,
  role: Role.OPERATOR_ADMIN,
  entityId: 'e1',
});

describe('NotificationsService', () => {
  it('creates an in-app notification per recipient and emails operators on a decision', async () => {
    const prisma = buildPrisma();
    const channel = emailChannel(0);
    const svc = new NotificationsService(prisma as never, mail as never, [channel]);

    await svc.returnDecision({
      submissionId: 's1',
      entityId: 'e1',
      approved: true,
      referenceNumber: 'NCA/SUB/2026/000001',
    });

    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(channel.calls).toBe(1);
    // Email recorded as sent on the first attempt.
    expect(prisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          emailStatus: NotificationDeliveryStatus.SENT,
          emailAttempts: 1,
        }),
      }),
    );
  });

  it('retries a transient email failure and records success', async () => {
    const prisma = buildPrisma();
    const channel = emailChannel(2); // fail twice, succeed on the third
    const svc = new NotificationsService(prisma as never, mail as never, [channel]);

    await svc.returnDecision({
      submissionId: 's1',
      entityId: 'e1',
      approved: false,
      referenceNumber: 'R1',
      rejectionReason: 'Fix totals',
    });

    expect(channel.calls).toBe(3);
    expect(prisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          emailStatus: NotificationDeliveryStatus.SENT,
          emailAttempts: 3,
        }),
      }),
    );
  });

  it('marks a delivery failed after exhausting retries, without throwing', async () => {
    const prisma = buildPrisma();
    const channel = emailChannel(99); // always fails
    const svc = new NotificationsService(prisma as never, mail as never, [channel]);

    await expect(
      svc.returnDecision({
        submissionId: 's1',
        entityId: 'e1',
        approved: true,
        referenceNumber: 'R1',
      }),
    ).resolves.toBeUndefined();

    expect(channel.calls).toBe(3);
    expect(prisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          emailStatus: NotificationDeliveryStatus.FAILED,
          emailAttempts: 3,
        }),
      }),
    );
  });

  it('notifies reviewers in-app only (no email) when a return awaits review', async () => {
    const prisma = buildPrisma();
    const channel = emailChannel(0);
    const svc = new NotificationsService(prisma as never, mail as never, [channel]);

    await svc.returnAwaitingReview({
      submissionId: 's1',
      stage: ReviewStage.CHECKER,
      referenceNumber: 'R1',
      entityName: 'Acme',
    });

    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(channel.calls).toBe(0); // reviewers get the in-app badge, not an email
  });

  it('scopes mark-as-read to the caller', async () => {
    const prisma = buildPrisma();
    const svc = new NotificationsService(prisma as never, mail as never, []);

    await svc.markRead(user('op1'), 'n1');
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'n1', recipientId: 'op1', readAt: null }),
      }),
    );
  });

  it('does not create notifications when there are no recipients', async () => {
    const prisma = buildPrisma();
    prisma.user.findMany.mockResolvedValueOnce([]);
    const svc = new NotificationsService(prisma as never, mail as never, [emailChannel(0)]);

    await svc.returnDecision({
      submissionId: 's1',
      entityId: 'e1',
      approved: true,
      referenceNumber: 'R1',
    });
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });
});
