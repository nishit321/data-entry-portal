import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { AuditAction, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';

jest.setTimeout(60000);

/**
 * Can the audit trail be rewritten?
 *
 * `docs/OPERATIONS.md` states that `audit_logs` "is append-only and is never edited or pruned by
 * the application". Its sibling spec, `audit-coverage`, proves the rows get *written*. This one
 * asks the question an auditor asks second, and it is the sharper of the two: a trail that the
 * system which produced it can quietly edit is not evidence of anything.
 *
 * Two layers, because they fail in different ways:
 *
 * 1. **The database refuses.** Triggers on `audit_logs` reject UPDATE, DELETE and TRUNCATE. This
 *    holds against code nobody has written yet, including code written in a hurry by somebody who
 *    never read the operations document.
 * 2. **No source file even asks.** A guard over `src/` that fails on a mutating call to
 *    `auditLog`. The database would stop it at run time; this stops it at review time, with the
 *    file and the line, instead of as a 500 in production three weeks later.
 *
 * **What none of this claims:** a superuser can disable a trigger or set
 * `session_replication_role`. That is exactly why `npm run preflight` fails a deployment whose
 * application connects as the superuser. The two are one control, finished only when the
 * application has a database role of its own.
 */
describe('audit trail immutability (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let audit: AuditService;
  let rowId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    audit = app.get(AuditService);
    await prisma.user.deleteMany({ where: { email: 'immutability-actor@x.test' } });

    // A row of this suite's own to attack, so nothing here depends on another spec's history.
    const row = await prisma.auditLog.create({
      data: {
        action: AuditAction.USER_LOGIN,
        entityType: 'ImmutabilityProbe',
        entityId: 'immutability-probe',
        metadata: { note: 'written by the immutability spec' },
      },
      select: { id: true },
    });
    rowId = row.id;
  });

  afterAll(async () => {
    // Deliberately no cleanup: the row cannot be deleted, which is the point of the spec. It is
    // one row, it is honestly labelled, and a suite that could tidy it away would be evidence
    // that the guard does not work.
    await app.close();
  });

  describe('the database refuses to let go of a record', () => {
    it('refuses to change one', async () => {
      await expect(
        prisma.auditLog.update({ where: { id: rowId }, data: { entityId: 'rewritten' } }),
      ).rejects.toThrow(/append-only/i);

      const after = await prisma.auditLog.findUnique({
        where: { id: rowId },
        select: { entityId: true },
      });
      expect(after?.entityId).toBe('immutability-probe');
    });

    it('refuses to change one through a bulk update, which is how it would really happen', async () => {
      // Nobody edits a single audit row by hand. The realistic shape is a tidy-up that touches
      // many at once, which is also the shape that would otherwise go unnoticed.
      await expect(
        prisma.auditLog.updateMany({
          where: { entityType: 'ImmutabilityProbe' },
          data: { entityId: 'rewritten' },
        }),
      ).rejects.toThrow(/append-only/i);
    });

    it('refuses to delete one', async () => {
      await expect(prisma.auditLog.delete({ where: { id: rowId } })).rejects.toThrow(
        /append-only/i,
      );
      expect(await prisma.auditLog.count({ where: { id: rowId } })).toBe(1);
    });

    it('refuses a bulk delete', async () => {
      await expect(
        prisma.auditLog.deleteMany({ where: { entityType: 'ImmutabilityProbe' } }),
      ).rejects.toThrow(/append-only/i);
      expect(await prisma.auditLog.count({ where: { id: rowId } })).toBe(1);
    });

    it('refuses a truncate, which fires no row triggers of its own', async () => {
      /*
       * The one that gets missed. `TRUNCATE` bypasses row-level triggers entirely, so a table
       * guarded only against UPDATE and DELETE can still be emptied in a single statement while
       * the guards sit there looking effective.
       */
      await expect(prisma.$executeRawUnsafe('TRUNCATE TABLE audit_logs')).rejects.toThrow(
        /append-only/i,
      );
      expect(await prisma.auditLog.count({ where: { id: rowId } })).toBe(1);
    });

    it('still accepts a new record, because append-only is not read-only', async () => {
      // The guard has to stop exactly one thing. A trail nothing can be added to is just as broken
      // as one anybody can edit, and a trigger written slightly wrong would do that.
      const added = await prisma.auditLog.create({
        data: {
          action: AuditAction.USER_LOGIN,
          entityType: 'ImmutabilityProbe',
          entityId: 'immutability-probe-2',
        },
        select: { id: true },
      });
      expect(added.id).toBeTruthy();
    });

    it('explains itself to whoever hits it', async () => {
      // Somebody will meet this error in the middle of writing a migration or a clean-up job, and
      // the message is the only chance to tell them why the answer is no.
      const message = await prisma.auditLog
        .delete({ where: { id: rowId } })
        .then(() => '')
        .catch((e: Error) => e.message);

      expect(message).toMatch(/append-only/i);
      expect(message).toMatch(/audit_logs/);
    });
  });

  describe('a record outlives the account that wrote it', () => {
    /*
     * The hole the triggers above found, which is the reason this spec is worth its length.
     *
     * `audit_logs.actor_id` carries `ON DELETE SET NULL`. Hard-deleting a user therefore ran an
     * UPDATE across every row they had written and left each one saying nobody did it — the exact
     * erasure an audit trail exists to prevent, reachable by deleting an account. In production
     * users are soft-deleted so it had almost certainly never happened, and "almost certainly had
     * not" is not a control.
     */
    it('still names who acted after their account is deleted outright', async () => {
      const actor = await prisma.user.create({
        data: {
          email: 'immutability-actor@x.test',
          passwordHash: 'not-a-real-hash',
          firstName: 'Gone',
          lastName: 'Tomorrow',
          role: Role.ANALYST,
        },
      });
      await audit.record({
        action: AuditAction.USER_LOGIN,
        actorId: actor.id,
        entityType: 'ImmutabilityProbe',
        entityId: 'outlives-its-author',
      });

      const before = await prisma.auditLog.findFirst({
        where: { entityId: 'outlives-its-author' },
        select: { id: true, actorEmail: true, actorName: true },
      });
      expect(before?.actorEmail).toBe('immutability-actor@x.test');
      expect(before?.actorName).toBe('Gone Tomorrow');

      // The delete is allowed — this is not an argument for keeping accounts forever.
      await prisma.user.delete({ where: { id: actor.id } });

      const after = await prisma.auditLog.findUnique({
        where: { id: before!.id },
        select: { actorId: true, actorEmail: true, actorName: true },
      });
      // The link is gone, which is what the foreign key is for. The answer is not.
      expect(after?.actorId).toBeNull();
      expect(after?.actorEmail).toBe('immutability-actor@x.test');
      expect(after?.actorName).toBe('Gone Tomorrow');
    });

    it('lets nothing else through on the way past', async () => {
      /*
       * The narrow exemption is the dangerous part of this design. It permits one transition —
       * `actor_id` to null, every other column untouched — and a version of it written slightly
       * too loosely would quietly permit editing the record while nulling the actor.
       */
      const row = await prisma.auditLog.findFirst({
        where: { entityType: 'ImmutabilityProbe' },
        select: { id: true },
      });
      await expect(
        prisma.auditLog.update({
          where: { id: row!.id },
          data: { actorId: null, entityId: 'rewritten-under-cover' },
        }),
      ).rejects.toThrow(/append-only/i);
    });
  });

  describe('no source file even asks', () => {
    /** Every `.ts` under `src/`, so a new module is covered the day it is added. */
    function sourceFiles(dir: string): string[] {
      return readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) return sourceFiles(full);
        return name.endsWith('.ts') ? [full] : [];
      });
    }

    it('never calls update, delete or upsert on the audit log', () => {
      /*
       * Read-time guard for a run-time rule. The database would refuse the call anyway, but it
       * would refuse it in production, inside whatever action triggered it, as a 500 with a
       * confusing cause. This says the file and the line instead.
       */
      const mutating = /auditLog\s*\.\s*(update|updateMany|delete|deleteMany|upsert)\b/;
      const offenders: string[] = [];

      for (const file of sourceFiles(join(__dirname, '..', 'src'))) {
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, index) => {
            if (mutating.test(line)) {
              offenders.push(
                `${file.replace(/.*[\\/]src[\\/]/, 'src/')}:${index + 1}  ${line.trim()}`,
              );
            }
          });
      }

      if (offenders.length > 0) {
        throw new Error(
          'The audit trail is append-only and something here tries to change it. Correct a wrong ' +
            'entry by recording a new one:\n  ' +
            offenders.join('\n  '),
        );
      }
    });

    it('is looking at real files, and enough of them', () => {
      // A guard that silently walked an empty directory would pass forever. This is the check
      // that the check works.
      const files = sourceFiles(join(__dirname, '..', 'src'));
      expect(files.length).toBeGreaterThan(50);
      expect(files.some((f) => f.endsWith('audit.service.ts'))).toBe(true);
    });
  });
});
