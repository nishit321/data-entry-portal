/* eslint-disable no-console -- a command-line tool reports by printing */
/**
 * Rehearse a restore, and check what came back (§9, OPERATIONS.md).
 *
 * OPERATIONS.md says "test the restore, not just the backup — a backup you have never restored is
 * a guess", and until this existed that sentence was advice nobody had followed. This is the
 * rehearsal: back the database up, restore it into a scratch database, and check that what came out
 * matches what went in.
 *
 *   npm run backup:verify
 *
 * It answers the questions that actually go wrong in a restore, rather than only "did the command
 * exit zero":
 *
 *  - Is every table back, with the same number of rows?
 *  - Did the enums, indexes and constraints come back, or only the data?
 *  - Are the attachment blobs there, and readable?
 *  - Does the schema still match what Prisma expects, so the app would boot against it?
 *
 * The scratch database is created and dropped by this script. It refuses to touch anything whose
 * name does not mark it as scratch, so a mistyped target cannot become a restore over real data.
 */
// These run outside Nest, so the environment the application reads has to be loaded here.
import 'dotenv/config';
import { execFileSync, execSync } from 'child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pgBin, takeBackup, toLibpqUrl } from './backup';
import { restoreBackup } from './restore';

/** Any scratch database this script creates carries this in its name, and it will touch no other. */
const SCRATCH_MARKER = 'restore_rehearsal';

/**
 * A check has three outcomes, not two.
 *
 * "Could not be checked" is not "passed". The first version of this script reported an unrunnable
 * check as `ok`, which is the exact failure this whole exercise exists to remove: a green wall that
 * means less than it appears to.
 */
type Outcome = 'ok' | 'failed' | 'unknown';

interface Check {
  what: string;
  outcome: Outcome;
  detail: string;
}

const checks: Check[] = [];
const record = (what: string, outcome: Outcome | boolean, detail = '') =>
  checks.push({
    what,
    outcome: typeof outcome === 'boolean' ? (outcome ? 'ok' : 'failed') : outcome,
    detail,
  });

function psql(databaseUrl: string, sql: string): string {
  return execFileSync(pgBin('psql'), [toLibpqUrl(databaseUrl), '-tAc', sql], { stdio: 'pipe' })
    .toString()
    .trim();
}

function adminUrl(databaseUrl: string): { admin: string; name: string } {
  const url = new URL(databaseUrl);
  const name = url.pathname.replace(/^\//, '');
  url.pathname = '/postgres';
  url.search = '';
  return { admin: url.toString(), name };
}

/** Row counts per table, which is the honest measure of whether the data came back. */
function rowCounts(databaseUrl: string): Map<string, number> {
  const sql = `
    select relname, n_live_tup
    from pg_stat_user_tables
    where schemaname = 'public'
    order by relname
  `;
  // n_live_tup is an estimate, so the counts are taken properly below for anything non-zero.
  const names = psql(
    databaseUrl,
    "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name",
  )
    .split('\n')
    .map((n) => n.trim())
    .filter(Boolean);
  void sql;

  const counts = new Map<string, number>();
  if (names.length === 0) return counts;

  // One statement for every table, so the comparison is exact rather than an estimate.
  const union = names
    .map((n) => `select '${n}' as t, count(*)::bigint as c from "${n}"`)
    .join(' union all ');
  for (const line of psql(databaseUrl, union).split('\n')) {
    const [table, count] = line.split('|');
    if (table) counts.set(table.trim(), Number(count));
  }
  return counts;
}

function countFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  const walk = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (statSync(child).size > 0) n += 1;
    }
  };
  walk(dir);
  return n;
}

async function main() {
  const source = process.env.DATABASE_URL;
  if (!source) {
    console.error('DATABASE_URL is not set. Refusing to guess which database to rehearse against.');
    process.exit(1);
  }
  const storageDir = process.env.STORAGE_DIR ?? 'storage';

  const { admin, name } = adminUrl(source);
  const scratchName = `${name}_${SCRATCH_MARKER}`;
  if (!scratchName.includes(SCRATCH_MARKER)) {
    console.error('Refusing to use a target that is not marked as scratch.');
    process.exit(1);
  }
  const scratchUrl = source.replace(`/${name}`, `/${scratchName}`);

  const workDir = mkdtempSync(join(tmpdir(), 'nca-restore-'));
  console.log(`Rehearsing a restore of "${name}" into "${scratchName}".`);
  console.log('');

  try {
    // 1. Take the backup.
    const backup = takeBackup({
      databaseUrl: source,
      storageDir,
      outDir: workDir,
      label: 'rehearsal',
    });
    const beforeCounts = rowCounts(source);
    const beforeFiles = countFiles(storageDir);
    record(
      'backup taken',
      true,
      `${(backup.bytes / 1024 / 1024).toFixed(1)} MB, ${beforeCounts.size} tables, ${beforeFiles} blobs`,
    );

    // 2. A clean scratch database.
    execFileSync(pgBin('psql'), [admin, '-c', `drop database if exists "${scratchName}"`], {
      stdio: 'pipe',
    });
    execFileSync(pgBin('psql'), [admin, '-c', `create database "${scratchName}"`], {
      stdio: 'pipe',
    });

    // 3. Restore into it, blobs included.
    const restoredStorage = join(workDir, 'restored-storage');
    const restored = restoreBackup({
      from: backup.dir,
      to: scratchUrl,
      storageDir: restoredStorage,
      clean: false,
    });
    record('restore ran', restored.tables > 0, `${restored.tables} tables`);

    // 4. Every table back?
    const afterCounts = rowCounts(scratchUrl);
    const missingTables = [...beforeCounts.keys()].filter((t) => !afterCounts.has(t));
    record(
      'every table came back',
      missingTables.length === 0,
      missingTables.length ? `missing: ${missingTables.join(', ')}` : `${afterCounts.size} tables`,
    );

    // 5. Every row back?
    const differing: string[] = [];
    for (const [table, before] of beforeCounts) {
      const after = afterCounts.get(table) ?? -1;
      if (after !== before) differing.push(`${table} ${before} to ${after}`);
    }
    const totalRows = [...beforeCounts.values()].reduce((a, b) => a + b, 0);
    record(
      'every row came back',
      differing.length === 0,
      differing.length ? differing.slice(0, 5).join(', ') : `${totalRows} rows across all tables`,
    );

    // 6. The structure, not just the data. A restore that brings back rows but loses a unique index
    // is the kind that looks fine until two returns collide six months later.
    const structure = (db: string) => ({
      enums: Number(psql(db, "select count(*) from pg_type where typtype = 'e'")),
      indexes: Number(psql(db, "select count(*) from pg_indexes where schemaname = 'public'")),
      constraints: Number(
        psql(
          db,
          "select count(*) from information_schema.table_constraints where constraint_schema = 'public'",
        ),
      ),
    });
    const before = structure(source);
    const after = structure(scratchUrl);
    record('enums came back', before.enums === after.enums, `${before.enums} to ${after.enums}`);
    record(
      'indexes came back',
      before.indexes === after.indexes,
      `${before.indexes} to ${after.indexes}`,
    );
    record(
      'constraints came back',
      before.constraints === after.constraints,
      `${before.constraints} to ${after.constraints}`,
    );

    // 7. The blobs. A database restore without them is a portal full of broken attachments.
    const afterFiles = countFiles(restoredStorage);
    record(
      'attachment blobs came back',
      afterFiles === beforeFiles,
      `${beforeFiles} to ${afterFiles} files`,
    );

    // 8. Would the application actually boot against it? Prisma answers that better than we can:
    // if the restored schema has drifted from the migrations, this reports it.
    let drift: Outcome = 'ok';
    let driftDetail = 'schema matches the migrations';
    try {
      // Through a shell: on Windows `npx` is a .cmd, and execFile cannot start one directly.
      execSync(
        `npx prisma migrate diff --from-url "${toLibpqUrl(scratchUrl)}" ` +
          `--to-schema-datamodel prisma/schema.prisma --exit-code`,
        { stdio: 'pipe', env: { ...process.env, DATABASE_URL: scratchUrl } },
      );
    } catch (error) {
      // Prisma exits 2 when there is a difference, which is the answer worth having. Any other
      // failure means the question was not answered, and saying so is the point.
      const status = (error as { status?: number }).status;
      if (status === 2) {
        drift = 'failed';
        driftDetail = 'the restored schema differs from the migrations';
      } else {
        drift = 'unknown';
        driftDetail = 'prisma could not be run, so this was not checked';
      }
    }
    record('restored schema matches the application', drift, driftDetail);
  } finally {
    execFileSync(pgBin('psql'), [admin, '-c', `drop database if exists "${scratchName}"`], {
      stdio: 'pipe',
    });
    rmSync(workDir, { recursive: true, force: true });
  }

  // --- Report ---------------------------------------------------------------
  const MARKS: Record<Outcome, string> = { ok: 'ok  ', failed: 'FAIL', unknown: '??  ' };

  console.log('');
  for (const check of checks) {
    console.log(`  ${MARKS[check.outcome]}  ${check.what.padEnd(42)}${check.detail}`);
  }
  console.log('');

  const failed = checks.filter((c) => c.outcome === 'failed');
  const unknown = checks.filter((c) => c.outcome === 'unknown');

  if (failed.length > 0) {
    console.log(
      `${failed.length} of ${checks.length} checks failed. This backup would not restore cleanly.`,
    );
    process.exit(1);
  }
  if (unknown.length > 0) {
    // Deliberately not a pass. A rehearsal that could not ask one of its questions has not answered
    // it, and reporting that as success is how a backup nobody can restore stays undiscovered.
    console.log(
      `${checks.length - unknown.length} checks passed, ${unknown.length} could not be checked. ` +
        'Fix the tooling and run it again before relying on this.',
    );
    process.exit(1);
  }
  console.log(
    `All ${checks.length} checks passed. A restore from this backup produces a working portal.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
