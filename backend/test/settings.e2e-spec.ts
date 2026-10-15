import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/common/utils/password.util';

jest.setTimeout(30000);
const OTP = '123456';

/**
 * The switches the Authority can throw for itself (NCA, 15 October 2026).
 *
 * "Enable/Disable Signup Facility settings."
 *
 * The portal shipped with `POST /auth/signup` open to the internet and the sign-in screen
 * inviting people to use it. A self-made account could not reach operator data - the entity scope
 * closes that door - but it was still an account on a regulator's portal that the regulator never
 * issued, and an administrator linking one to an operator later would have no way of knowing it
 * came from outside.
 */
describe('Settings (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: import('http').Server;

  const PASSWORD = 'Passw0rd!23';
  const adminEmail = 'e2e-set-admin@nca.test';
  const operatorEmail = 'e2e-set-op@nca.test';
  const emails = [adminEmail, operatorEmail];
  const newcomer = 'e2e-set-newcomer@x.test';

  let adminToken: string;
  let operatorToken: string;

  async function login(email: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD });
    if (res.body.accessToken) return res.body.accessToken as string;
    const v = await request(server)
      .post('/api/v1/auth/verify-otp')
      .send({ challengeId: res.body.challengeId, code: OTP });
    return v.body.accessToken as string;
  }

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function setSignup(enabled: boolean) {
    await request(server)
      .patch('/api/v1/settings/signup.enabled')
      .set(auth(adminToken))
      .send({ value: enabled })
      .expect(200);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    await prisma.user.deleteMany({ where: { email: { in: [...emails, newcomer] } } });
    const passwordHash = await hashPassword(PASSWORD);
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        firstName: 'Admin',
        lastName: 'NCA',
        role: Role.ADMIN,
      },
    });
    await prisma.user.create({
      data: {
        email: operatorEmail,
        passwordHash,
        firstName: 'Ana',
        lastName: 'Lyst',
        role: Role.ANALYST,
      },
    });
    adminToken = await login(adminEmail);
    operatorToken = await login(operatorEmail);
  });

  afterAll(async () => {
    // Leave the switch as the portal ships, so a later suite is not surprised by it.
    await prisma.systemSetting.deleteMany({ where: { key: 'signup.enabled' } });
    await prisma.user.deleteMany({ where: { email: { in: [...emails, newcomer] } } });
    await app.close();
  });

  afterEach(async () => {
    await prisma.systemSetting.deleteMany({ where: { key: 'signup.enabled' } });
  });

  it('refuses an account from outside until the Authority opens the door', async () => {
    const res = await request(server)
      .post('/api/v1/auth/signup')
      .send({ email: newcomer, firstName: 'New', lastName: 'Comer', password: PASSWORD })
      .expect(403);
    // And says what to do instead, rather than simply refusing.
    expect(res.body.message).toMatch(/created by the Authority/i);

    const created = await prisma.user.findFirst({ where: { email: newcomer } });
    expect(created).toBeNull();
  });

  it('lets one through once an administrator turns it on', async () => {
    await setSignup(true);
    await request(server)
      .post('/api/v1/auth/signup')
      .send({ email: newcomer, firstName: 'New', lastName: 'Comer', password: PASSWORD })
      .expect(201);
    await prisma.user.deleteMany({ where: { email: newcomer } });
  });

  it('closes again when it is turned back off', async () => {
    // The switch has to work both ways. One that can only be turned on is a migration.
    await setSignup(true);
    await setSignup(false);
    await request(server)
      .post('/api/v1/auth/signup')
      .send({ email: newcomer, firstName: 'New', lastName: 'Comer', password: PASSWORD })
      .expect(403);
  });

  it('tells the sign-in screen what it needs, without an account', async () => {
    /*
     * The screen has to decide whether to offer "create an account" before anybody has signed in,
     * so this one route is public. What it must not do is describe the rest of the configuration.
     */
    const res = await request(server).get('/api/v1/settings/public').expect(200);
    // Keys given as arrays: these contain dots, and `toHaveProperty` reads a bare string as a
    // path, so 'signup.enabled' would look for body.signup.enabled and find nothing.
    expect(res.body).toHaveProperty(['signup.enabled'], false);
    expect(res.body).toHaveProperty(['session.idleMinutes']);
    // Values only: no labels, no bounds, no hint of what else can be switched.
    expect(Object.values(res.body).every((v) => typeof v !== 'object')).toBe(true);
  });

  it('keeps the full list of switches to administrators', async () => {
    /*
     * An analyst is Authority staff and still has no business here. A list of what a system has
     * turned off is a map for anybody looking for a way in, and this is the screen that turns
     * authentication features on and off.
     */
    await request(server).get('/api/v1/settings').set(auth(operatorToken)).expect(403);
    await request(server).get('/api/v1/settings').expect(401);

    const res = await request(server).get('/api/v1/settings').set(auth(adminToken)).expect(200);
    const signup = (res.body as { key: string; value: boolean }[]).find(
      (s) => s.key === 'signup.enabled',
    );
    expect(signup).toMatchObject({ value: false, type: 'boolean' });
  });

  it('refuses a setting it has never heard of', async () => {
    // Otherwise a typo writes a row nothing reads, and an administrator is looking at a switch
    // that does nothing at all.
    await request(server)
      .patch('/api/v1/settings/signup.enabledd')
      .set(auth(adminToken))
      .send({ value: true })
      .expect(400);
  });

  it('dates the access token from the idle timeout, not from a second setting', async () => {
    /*
     * These were two numbers until they could disagree.
     *
     * Tokens used to live a day, which meant one copied off a shared machine was good until
     * tomorrow. And had the lifetime stayed configured apart from the idle window, an
     * administrator setting the window to two hours would still have had people thrown out at
     * whatever the token said, with nothing on screen to explain it.
     *
     * So the token is read back and its own expiry checked against the setting that produced it.
     */
    const lifetimeMinutes = async () => {
      const token = await login(adminEmail);
      const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64').toString('utf8')) as {
        iat: number;
        exp: number;
      };
      return Math.round((claims.exp - claims.iat) / 60);
    };

    // The default window, plus the stated few minutes of slack for a renewal in flight.
    expect(await lifetimeMinutes()).toBe(25);

    await request(server)
      .patch('/api/v1/settings/session.idleMinutes')
      .set(auth(adminToken))
      .send({ value: 45 })
      .expect(200);
    expect(await lifetimeMinutes()).toBe(50);

    await prisma.systemSetting.deleteMany({ where: { key: 'session.idleMinutes' } });
  });

  it('lets somebody still working carry on, without a second credential to look after', async () => {
    const res = await request(server)
      .post('/api/v1/auth/refresh')
      .set(auth(adminToken))
      .expect(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.accessToken).not.toBe(adminToken);
    expect(res.body.user.email).toBe(adminEmail);
  });

  it('cannot revive a session that is already gone', async () => {
    /*
     * The whole safety of renewing without a long-lived refresh credential rests on this: the
     * guard rejects an expired or absent token before the route is reached, so renewal can only
     * ever lengthen a session that is live right now.
     */
    await request(server).post('/api/v1/auth/refresh').expect(401);
    await request(server).post('/api/v1/auth/refresh').set(auth('not.a.token')).expect(401);
  });

  it('refuses an idle timeout that is not a timeout', async () => {
    await request(server)
      .patch('/api/v1/settings/session.idleMinutes')
      .set(auth(adminToken))
      .send({ value: 2 })
      .expect(400);
    await request(server)
      .patch('/api/v1/settings/session.idleMinutes')
      .set(auth(adminToken))
      .send({ value: 20 })
      .expect(200);
    await prisma.systemSetting.deleteMany({ where: { key: 'session.idleMinutes' } });
  });
});
