import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { inventoryRoutes, type RouteFact } from '../src/common/utils/route-inventory.util';

jest.setTimeout(60000);

/**
 * A census of every route, and a reviewed reason for each one that is not role-guarded.
 *
 * `RolesGuard` is fail-open by design: a route with no `@Roles()` lets every authenticated user
 * through, and `@Public()` skips authentication entirely. Both are the right answer sometimes.
 * Neither leaves a trace when it happens by accident — a new controller written without the
 * decorator looks, from outside, exactly like a controller deliberately opened to everyone.
 *
 * So the exceptions are written down. Add a route that is public or open to any signed-in user and
 * this spec fails until someone says, in a sentence, why. That sentence is the whole point: it
 * costs a minute to write and it is the only thing standing between a missing decorator and a
 * quiet hole.
 */

/** No authentication at all. */
const PUBLIC: Record<string, string> = {
  'GET /api/health': 'liveness for the load balancer, before anyone has signed in.',
  'GET /api/health/live': 'the same, without the dependency checks.',

  'POST /api/v1/auth/login': 'you cannot authenticate to authenticate.',
  'POST /api/v1/auth/verify-otp': 'the second half of signing in.',
  'POST /api/v1/auth/resend-otp': 'the code did not arrive; the user is still signing in.',
  'POST /api/v1/auth/signup': 'an operator with no account yet asks for one.',
  'POST /api/v1/auth/forgot-password': 'reached precisely by people who cannot sign in.',
  'POST /api/v1/auth/reset-password': 'the same, carrying a single-use token instead of a session.',

  'GET /api/v1/public/overview':
    'the citizen-facing portal (Q4). Aggregated and disclosure-controlled.',
  'GET /api/v1/public/indicators': 'the same: published sector figures, never operator-level.',
  'GET /api/v1/public/complaints-summary': 'the same: counts, not complainants.',

  'POST /api/v1/complaints':
    'a citizen files without an account. That is the point of the channel.',
  'POST /api/v1/complaints/track':
    'a citizen checks their own complaint by reference. Returns only that one case.',
};

/** Authenticated, but open to every role. Each of these was looked at. */
const ANY_SIGNED_IN: Record<string, string> = {
  'GET /api/v1/auth/me': 'your own identity. Scoped to the token that asked.',

  'GET /api/v1/auth/phone':
    'whether a number can be confirmed at all, so a screen can say so before asking for one. It ' +
    'carries no data about anybody.',
  'POST /api/v1/auth/phone':
    "starts confirming the caller's own number. Rate limited to three a minute, because each call " +
    "spends the Authority's SMS balance and rings somebody's handset.",
  'POST /api/v1/auth/phone/verify': "confirms the caller's own number against a code sent to it.",
  'DELETE /api/v1/auth/phone': "removes the caller's own number.",

  'GET /api/v1/notifications': "the caller's own notifications; the query is scoped to them.",
  'GET /api/v1/notifications/unread-count': 'a count of the same.',
  'PATCH /api/v1/notifications/:id/read':
    "marks one of the caller's own read; ownership is proved in the segregation sweep.",
  'POST /api/v1/notifications/read-all': "marks the caller's own read.",

  'GET /api/v1/reference-data/categories':
    'the names of shared lookup lists. The same for everyone by design.',
  'GET /api/v1/reference-data/lookup/:category': 'the contents of one of those shared lists.',

  'GET /api/v1/signatures/certificates': "the caller's own signing certificates.",
  'POST /api/v1/signatures/certificates': 'registers one against the caller.',
  'DELETE /api/v1/signatures/certificates/:id':
    "revokes one of the caller's own; proved in the segregation sweep.",
  'GET /api/v1/signatures/returns/:id/digest':
    'entity-scoped inside the service rather than by role. Proved in the segregation sweep.',
  'GET /api/v1/signatures/returns/:id/verify':
    'the same. Anyone who may see a return may re-check its signature; that is what non-repudiation means.',
};

describe('route inventory (e2e)', () => {
  let app: INestApplication;
  let routes: RouteFact[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    routes = inventoryRoutes(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves at least the routes we know about', () => {
    // A sanity floor. If this collapses, the census is reading the wrong thing and every check
    // below would pass by finding nothing.
    expect(routes.length).toBeGreaterThan(100);
  });

  it('every public route has a written reason', () => {
    const unexplained = routes
      .filter((r) => r.access === 'public')
      .map((r) => r.signature)
      .filter((sig) => !(sig in PUBLIC));

    if (unexplained.length > 0) {
      throw new Error(
        'These routes need no authentication at all. If that is deliberate, add the reason to ' +
          'PUBLIC in this spec. If it is not, add @Roles(), or remove @Public().\n  ' +
          unexplained.join('\n  '),
      );
    }
  });

  it('every route open to any signed-in user has a written reason', () => {
    const unexplained = routes
      // Machine routes carry their own credential guard; a user session cannot reach them.
      .filter((r) => r.access === 'any-signed-in' && !r.machine)
      .map((r) => r.signature)
      .filter((sig) => !(sig in ANY_SIGNED_IN));

    if (unexplained.length > 0) {
      throw new Error(
        'These routes carry no @Roles(), so every authenticated user reaches them: an operator ' +
          'submitter at one company as readily as an NCA approver. If that is deliberate, add ' +
          'the reason to ANY_SIGNED_IN in this spec. If it is not, add @Roles().\n  ' +
          unexplained.join('\n  '),
      );
    }
  });

  it('every machine route is behind the machine guard, and nothing else is', () => {
    const machine = routes.filter((r) => r.machine);
    expect(machine.length).toBeGreaterThan(0);

    // The raw-body middleware keys off the path, so the two must agree or signatures break.
    const misplaced = machine.filter((r) => !r.path.startsWith('/api/v1/machine/'));
    expect(misplaced.map((r) => r.signature)).toEqual([]);

    const unmarked = routes.filter((r) => r.path.startsWith('/api/v1/machine/') && !r.machine);
    expect(unmarked.map((r) => r.signature)).toEqual([]);
  });

  it('lists nothing that has since been withdrawn', () => {
    const live = new Set(routes.map((r) => r.signature));
    const stale = [...Object.keys(PUBLIC), ...Object.keys(ANY_SIGNED_IN)].filter(
      (sig) => !live.has(sig),
    );

    if (stale.length > 0) {
      throw new Error(
        `These are explained here but no longer served. Delete their lines:\n  ${stale.join('\n  ')}`,
      );
    }
  });
});
