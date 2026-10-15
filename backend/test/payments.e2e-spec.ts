import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  EnforcementReason,
  EnforcementStatus,
  EntityStatus,
  EntityType,
  Role,
  SubmissionStatus,
  TemplateStatus,
} from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/common/utils/password.util';

jest.setTimeout(60000);
const OTP = '123456';

/**
 * Payments against levies and penalties (NCA, October 2026: "amounts paid, outstanding balances,
 * and payment rates").
 *
 * One thing about this suite is different from every other one, and on purpose. A payment can
 * never be deleted, by the application or by anybody connected to the database, so this suite
 * cannot tidy up after itself the way the others do. Its fixtures are therefore unique to each run
 * and are soft-deleted at the end, which is exactly what happens to an operator in production.
 *
 * The levy period and its rate sit in 2001, a window no other suite uses, because a levy rate is
 * global: one that covered this year would change the levy every other suite expects.
 */
describe('Payments (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;

  const RUN = Date.now().toString(36);
  const PASSWORD = 'Passw0rd!23';
  const email = (who: string) => `e2e-pay-${who}-${RUN}@nca.test`;

  let adminToken: string;
  let supervisorToken: string;
  let analystToken: string;
  let opXToken: string;
  let opYToken: string;

  let entityX: string;
  let entityY: string;
  let periodId: string;
  let emptyPeriodId: string;
  let payableCaseId: string;
  let pendingCaseId: string;
  let rateId: string;
  const created: { users: string[]; entities: string[]; periods: string[]; template?: string } = {
    users: [],
    entities: [],
    periods: [],
  };

  async function login(address: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: address, password: PASSWORD });
    if (res.body.accessToken) return res.body.accessToken as string;
    const v = await request(server)
      .post('/api/v1/auth/verify-otp')
      .send({ challengeId: res.body.challengeId, code: OTP });
    return v.body.accessToken as string;
  }

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const levyPayment = (over: Record<string, unknown> = {}) => ({
    kind: 'LEVY',
    entityId: entityX,
    periodId,
    amount: 8000,
    paidOn: '2026-10-01',
    method: 'BANK_TRANSFER',
    bankReference: `TRF-${RUN}-1`,
    ...over,
  });

  async function balanceFor(token: string, entityId?: string) {
    const res = await request(server)
      .get('/api/v1/payments/balances')
      .query({ periodId, ...(entityId ? { entityId } : {}) })
      .set(auth(token))
      .expect(200);
    return res.body as {
      totals: { due: number; paid: number; outstanding: number; overpaid: number };
      charges: {
        kind: string;
        entity: { id: string };
        due: number;
        paid: number;
        status: string;
      }[];
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    const passwordHash = await hashPassword(PASSWORD);
    const x = await prisma.entity.create({
      data: {
        name: `Pay X ${RUN}`,
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: `E2E/PAYX/${RUN}`,
      },
    });
    const y = await prisma.entity.create({
      data: {
        name: `Pay Y ${RUN}`,
        type: EntityType.MNO,
        status: EntityStatus.ACTIVE,
        licenceNumber: `E2E/PAYY/${RUN}`,
      },
    });
    entityX = x.id;
    entityY = y.id;
    created.entities.push(x.id, y.id);

    const mkUser = async (who: string, role: Role, entityId?: string) => {
      const u = await prisma.user.create({
        data: { email: email(who), passwordHash, firstName: who, lastName: 'Pay', role, entityId },
      });
      created.users.push(u.id);
      return u;
    };
    await mkUser('admin', Role.ADMIN);
    await mkUser('supervisor', Role.SUPERVISOR);
    await mkUser('analyst', Role.ANALYST);
    const opX = await mkUser('opx', Role.OPERATOR_ADMIN, x.id);
    await mkUser('opy', Role.OPERATOR_ADMIN, y.id);

    const tpl = await prisma.reportingTemplate.create({
      data: {
        name: `E2E Payments ${RUN}`,
        version: 1,
        status: TemplateStatus.PUBLISHED,
        publishedAt: new Date(),
        sections: {
          create: {
            key: 'financials',
            title: 'Financials',
            applicableEntityTypes: [EntityType.MNO],
            frequency: 'ANNUAL',
            fields: {
              create: {
                key: 'total_revenue',
                label: 'Total annual revenue',
                dataType: 'MONETARY',
                isLevyBasis: true,
              },
            },
          },
        },
      },
      include: { sections: { include: { fields: true } } },
    });
    created.template = tpl.id;

    const mkPeriod = async (label: string) => {
      const p = await prisma.reportingPeriod.create({
        data: {
          templateId: tpl.id,
          frequency: 'ANNUAL',
          label,
          periodStart: new Date('2001-01-01'),
          periodEnd: new Date('2001-06-30'),
          dueDate: new Date('2001-07-31'),
          status: 'CLOSED',
        },
      });
      created.periods.push(p.id);
      return p.id;
    };
    periodId = await mkPeriod(`2001 H1 ${RUN}`);
    emptyPeriodId = await mkPeriod(`2001 H1b ${RUN}`);

    // 2% of 1,000,000: a levy of 20,000 for X. Y files nothing, so owes no levy.
    const rate = await prisma.levyRate.create({
      data: {
        ratePercent: 2,
        effectiveFrom: new Date('2001-01-01'),
        effectiveTo: new Date('2001-12-31'),
        label: `E2E payments ${RUN}`,
      },
    });
    rateId = rate.id;
    await prisma.submission.create({
      data: {
        entityId: x.id,
        periodId,
        templateId: tpl.id,
        createdById: opX.id,
        status: SubmissionStatus.APPROVED,
        isLate: false,
        submittedAt: new Date('2001-07-20'),
        referenceNumber: `NCA/SUB/2001/${RUN}`,
        values: { create: [{ fieldId: tpl.sections[0]!.fields[0]!.id, valueText: '1000000' }] },
      },
    });

    // Y's two penalties: one assessed and payable, one still inside its remedy notice.
    payableCaseId = (
      await prisma.enforcementCase.create({
        data: {
          entityId: y.id,
          periodId,
          reason: EnforcementReason.MISSED_DEADLINE,
          status: EnforcementStatus.OPEN,
          penaltyAmount: 5000,
          penaltyAssessedAt: new Date('2001-09-01'),
        },
      })
    ).id;
    pendingCaseId = (
      await prisma.enforcementCase.create({
        data: {
          entityId: y.id,
          periodId: emptyPeriodId,
          reason: EnforcementReason.MISSED_DEADLINE,
          status: EnforcementStatus.OPEN,
          penaltyAmount: 3000,
          penaltyAssessedAt: null,
          remedyDueAt: new Date(Date.now() + 10 * 86400000),
        },
      })
    ).id;

    adminToken = await login(email('admin'));
    supervisorToken = await login(email('supervisor'));
    analystToken = await login(email('analyst'));
    opXToken = await login(email('opx'));
    opYToken = await login(email('opy'));
  });

  afterAll(async () => {
    // Soft deletion, as production does: payments refer to these and can never be removed.
    const now = new Date();
    await prisma.levyRate.update({ where: { id: rateId }, data: { deletedAt: now } });
    await prisma.submission.updateMany({
      where: { periodId: { in: created.periods } },
      data: { deletedAt: now },
    });
    await prisma.reportingPeriod.updateMany({
      where: { id: { in: created.periods } },
      data: { deletedAt: now },
    });
    await prisma.reportingTemplate.update({
      where: { id: created.template! },
      data: { deletedAt: now },
    });
    await prisma.entity.updateMany({
      where: { id: { in: created.entities } },
      data: { deletedAt: now, status: EntityStatus.DEREGISTERED },
    });
    await prisma.user.updateMany({
      where: { id: { in: created.users } },
      data: { deletedAt: now, isActive: false },
    });
    await app.close();
  });

  describe('who may handle money', () => {
    it('is the Authority, never the operator that paid', async () => {
      // An operator saying it has paid is not evidence that it has. The bank statement is.
      await request(server).post('/api/v1/payments').send(levyPayment()).expect(401);
      await request(server)
        .post('/api/v1/payments')
        .set(auth(opXToken))
        .send(levyPayment())
        .expect(403);
      await request(server)
        .post('/api/v1/payments')
        .set(auth(analystToken))
        .send(levyPayment())
        .expect(403);
    });
  });

  describe('recording a levy payment', () => {
    let receipt: string;

    it('issues a receipt and moves the balance', async () => {
      const res = await request(server)
        .post('/api/v1/payments')
        .set(auth(adminToken))
        .send(levyPayment())
        .expect(201);
      receipt = res.body.receiptNumber;
      expect(receipt).toMatch(/^NCA\/RCT\/\d{4}\/\d{6}$/);

      /*
       * And leaves a record in the audit trail, read back rather than assumed. This is where the
       * audit census sends anybody asking whether POST /payments is recorded: it cannot fixture a
       * payment itself, because it cleans up by deletion and a payment never can be.
       */
      const trail = await prisma.auditLog.findFirst({
        where: { action: 'PAYMENT_RECORDED', entityId: res.body.id },
        select: { actorId: true, metadata: true },
      });
      expect(trail).not.toBeNull();
      expect(trail!.metadata).toMatchObject({ receiptNumber: receipt, amount: 8000 });
      expect(res.body.amount).toBe(8000);

      const b = await balanceFor(adminToken, entityX);
      const levy = b.charges.find((c) => c.kind === 'LEVY')!;
      expect(levy).toMatchObject({ due: 20000, paid: 8000, status: 'PART_PAID' });
      expect(b.totals.outstanding).toBe(12000);
    });

    it('refuses the same transfer typed in twice, and names the receipt it already has', async () => {
      const res = await request(server)
        .post('/api/v1/payments')
        .set(auth(adminToken))
        .send(levyPayment())
        .expect(409);
      expect(res.body.message).toContain(receipt);
    });

    it('takes a second transfer and shows the levy settled', async () => {
      await request(server)
        .post('/api/v1/payments')
        .set(auth(supervisorToken))
        .send(levyPayment({ amount: 12000, bankReference: `TRF-${RUN}-2` }))
        .expect(201);
      const levy = (await balanceFor(adminToken, entityX)).charges.find((c) => c.kind === 'LEVY')!;
      expect(levy).toMatchObject({ paid: 20000, status: 'PAID' });
    });

    it('records money beyond what was due as overpaid, rather than refusing it', async () => {
      // The record has to match the bank. Money that arrived has to appear somewhere.
      await request(server)
        .post('/api/v1/payments')
        .set(auth(adminToken))
        .send(levyPayment({ amount: 500, bankReference: `TRF-${RUN}-3` }))
        .expect(201);
      const b = await balanceFor(adminToken, entityX);
      expect(b.charges.find((c) => c.kind === 'LEVY')).toMatchObject({ status: 'OVERPAID' });
      expect(b.totals.overpaid).toBe(500);
    });

    it('refuses a date that has not happened yet', async () => {
      const res = await request(server)
        .post('/api/v1/payments')
        .set(auth(adminToken))
        .send(levyPayment({ paidOn: '2999-01-01', bankReference: `TRF-${RUN}-F` }))
        .expect(400);
      expect(res.body.message).toMatch(/future/);
    });

    it('refuses a levy that has not been assessed', async () => {
      // Y filed nothing for the period, so there is no levy to pay.
      const res = await request(server)
        .post('/api/v1/payments')
        .set(auth(adminToken))
        .send(levyPayment({ entityId: entityY, bankReference: `TRF-${RUN}-Y` }))
        .expect(400);
      expect(res.body.message).toMatch(/no approved return/);
    });
  });

  describe('recording a penalty payment', () => {
    const penalty = (caseId: string, over: Record<string, unknown> = {}) => ({
      kind: 'PENALTY',
      entityId: entityY,
      enforcementCaseId: caseId,
      amount: 5000,
      paidOn: '2026-10-02',
      method: 'MOBILE_MONEY',
      bankReference: `MM-${RUN}-${caseId.slice(0, 6)}`,
      ...over,
    });

    it('settles an assessed penalty', async () => {
      await request(server)
        .post('/api/v1/payments')
        .set(auth(adminToken))
        .send(penalty(payableCaseId))
        .expect(201);
      const b = await balanceFor(adminToken, entityY);
      expect(b.charges.find((c) => c.kind === 'PENALTY')).toMatchObject({
        due: 5000,
        status: 'PAID',
      });
    });

    it('refuses a penalty still inside its remedy notice', async () => {
      // Nothing is payable during the thirty days. Taking money for it would be taking a payment
      // the Act says is not yet owed.
      const res = await request(server)
        .post('/api/v1/payments')
        .set(auth(adminToken))
        .send(penalty(pendingCaseId))
        .expect(400);
      expect(res.body.message).toMatch(/not payable yet/);
    });

    it("refuses a case that is another operator's", async () => {
      await request(server)
        .post('/api/v1/payments')
        .set(auth(adminToken))
        .send(penalty(payableCaseId, { entityId: entityX }))
        .expect(404);
    });
  });

  describe('reversing a payment', () => {
    let paymentId: string;

    beforeAll(async () => {
      const res = await request(server)
        .post('/api/v1/payments')
        .set(auth(adminToken))
        .send(levyPayment({ amount: 100, bankReference: `TRF-${RUN}-R` }))
        .expect(201);
      paymentId = res.body.id;
    });

    it('is never done by the person who recorded it', async () => {
      // One officer able to both enter money and remove it could make any receipt disappear.
      const res = await request(server)
        .post(`/api/v1/payments/${paymentId}/reverse`)
        .set(auth(adminToken))
        .send({ reason: 'Keyed against the wrong operator by mistake.' })
        .expect(403);
      expect(res.body.message).toMatch(/somebody other than/);
    });

    it('needs a real reason', async () => {
      await request(server)
        .post(`/api/v1/payments/${paymentId}/reverse`)
        .set(auth(supervisorToken))
        .send({ reason: 'wrong' })
        .expect(400);
    });

    it('keeps the payment on record and takes its money out of the balance', async () => {
      const before = (await balanceFor(adminToken, entityX)).totals.paid;
      const res = await request(server)
        .post(`/api/v1/payments/${paymentId}/reverse`)
        .set(auth(supervisorToken))
        .send({ reason: 'Keyed against the wrong operator by mistake.' })
        .expect(200);
      expect(res.body.reversedAt).toEqual(expect.any(String));
      const trail = await prisma.auditLog.findFirst({
        where: { action: 'PAYMENT_REVERSED', entityId: paymentId },
        select: { metadata: true },
      });
      expect(trail?.metadata).toMatchObject({
        reason: 'Keyed against the wrong operator by mistake.',
      });
      expect((await balanceFor(adminToken, entityX)).totals.paid).toBe(before - 100);

      // Still listed, because it is part of the record.
      const list = await request(server)
        .get('/api/v1/payments')
        .query({ entityId: entityX })
        .set(auth(adminToken))
        .expect(200);
      expect(list.body.data.some((p: { id: string }) => p.id === paymentId)).toBe(true);
    });

    it('happens once', async () => {
      await request(server)
        .post(`/api/v1/payments/${paymentId}/reverse`)
        .set(auth(supervisorToken))
        .send({ reason: 'Trying to reverse it a second time.' })
        .expect(409);
    });
  });

  describe('the database itself', () => {
    /*
     * The application never edits or deletes a payment, but that is a convention. These go
     * straight to Postgres, past the service, to show the convention is not all there is.
     */
    let id: string;

    beforeAll(async () => {
      const p = await prisma.payment.findFirst({
        where: { entityId: entityX, reversedAt: null },
        select: { id: true },
      });
      id = p!.id;
    });

    it('refuses to change an amount', async () => {
      await expect(prisma.payment.update({ where: { id }, data: { amount: 1 } })).rejects.toThrow(
        /cannot be changed once recorded/,
      );
    });

    it('refuses to delete a payment', async () => {
      await expect(prisma.payment.delete({ where: { id } })).rejects.toThrow(/cannot be deleted/);
    });

    it('refuses a reversal by the person who recorded it, even with the service bypassed', async () => {
      // The service refuses this first. This is the floor under it, for the day somebody writes a
      // second path to the same table.
      const p = await prisma.payment.findFirst({
        where: { entityId: entityX, reversedAt: null },
        select: { id: true, recordedById: true },
      });
      await expect(
        prisma.payment.update({
          where: { id: p!.id },
          data: {
            reversedAt: new Date(),
            reversedById: p!.recordedById,
            reversalReason: 'Reversing my own entry, past the service.',
          },
        }),
      ).rejects.toThrow(/payments_reverser_differs/);
    });

    it('refuses to undo a reversal', async () => {
      const reversed = await prisma.payment.findFirst({
        where: { entityId: entityX, reversedAt: { not: null } },
        select: { id: true },
      });
      await expect(
        prisma.payment.update({
          where: { id: reversed!.id },
          data: { reversedAt: null, reversedById: null, reversalReason: null },
        }),
      ).rejects.toThrow(/cannot be changed once recorded/);
    });
  });

  describe('what an operator sees', () => {
    it('is its own balance and payments, whatever it asks for', async () => {
      const b = await balanceFor(opXToken, entityY);
      expect(b.charges.every((c) => c.entity.id === entityX)).toBe(true);
      expect(b.charges.length).toBeGreaterThan(0);

      const list = await request(server)
        .get('/api/v1/payments')
        .query({ entityId: entityY })
        .set(auth(opXToken))
        .expect(200);
      // Not empty first: `every` is true of an empty list, which would pass a leak and a broken
      // list alike.
      expect(list.body.data.length).toBeGreaterThan(0);
      expect(list.body.data.every((p: { entity: { id: string } }) => p.entity.id === entityX)).toBe(
        true,
      );
    });

    it("can download its own receipt, and not anybody else's", async () => {
      const own = await prisma.payment.findFirst({
        where: { entityId: entityX },
        select: { id: true },
      });
      const res = await request(server)
        .get(`/api/v1/payments/${own!.id}/receipt.pdf`)
        .set(auth(opXToken))
        .expect(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.body.subarray(0, 4).toString()).toBe('%PDF');

      await request(server)
        .get(`/api/v1/payments/${own!.id}/receipt.pdf`)
        .set(auth(opYToken))
        .expect(403);
    });
  });
});
