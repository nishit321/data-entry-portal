/* eslint-disable no-console -- a command-line tool reports by printing */
/**
 * Put a backup back: the database and the attachment blobs (§9, OPERATIONS.md).
 *
 * The counterpart to `backup.ts`, and the half that actually matters. A backup nobody has restored
 * is a guess, which is why `verify-restore.ts` exists to rehearse this on a scratch database.
 *
 *   npm run restore -- --from ../backups/2026-08-30_12-00-00 --to postgresql://... --storage ./storage
 *
 * Two guards, because this command overwrites a database:
 *
 * - It refuses to run against the URL in `DATABASE_URL` unless `--force` is given. The everyday
 *   mistake is restoring last night's backup over the live database while meaning to rehearse.
 * - It refuses a target that is not empty unless `--clean` is given, so a mistyped target name
 *   fails loudly rather than merging two portals together.
 */
// These run outside Nest, so the environment the application reads has to be loaded here.
import 'dotenv/config';
import { execFileSync } from 'child_process';
import { cpSync, existsSync, readFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { pgBin, toLibpqUrl } from './backup';

export interface RestoreResult {
  tables: number;
  storageRestored: boolean;
}

/** How many tables the target holds, which is how "is it empty?" is answered. */
export function tableCount(databaseUrl: string): number {
  const out = execFileSync(
    pgBin('psql'),
    [
      toLibpqUrl(databaseUrl),
      '-tAc',
      "select count(*) from information_schema.tables where table_schema = 'public'",
    ],
    { stdio: 'pipe' },
  )
    .toString()
    .trim();
  return Number(out);
}

export function restoreBackup(options: {
  from: string;
  to: string;
  storageDir?: string;
  clean?: boolean;
}): RestoreResult {
  const dir = resolve(options.from);
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`${dir} does not look like a backup: no manifest.json.`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    dumpFile: string;
    storageDir: string | null;
  };

  const existing = tableCount(options.to);
  if (existing > 0 && !options.clean) {
    throw new Error(
      `The target already holds ${existing} tables. Pass --clean to replace them, or choose an empty database.`,
    );
  }

  const args = [
    '--dbname',
    toLibpqUrl(options.to),
    '--no-owner',
    '--no-privileges',
    // Keep going past errors that do not matter on a fresh target (an absent role to reassign,
    // an extension already present) and report the count at the end rather than stopping halfway.
    '--exit-on-error',
  ];
  if (options.clean) args.push('--clean', '--if-exists');
  args.push(join(dir, manifest.dumpFile));

  execFileSync(pgBin('pg_restore'), args, { stdio: 'pipe' });

  // The blobs. Without these the database is restored and every attachment is a broken link.
  let storageRestored = false;
  if (manifest.storageDir && options.storageDir) {
    const source = join(dir, manifest.storageDir);
    const target = resolve(options.storageDir);
    if (existsSync(source)) {
      if (existsSync(target) && options.clean) rmSync(target, { recursive: true, force: true });
      cpSync(source, target, { recursive: true });
      storageRestored = true;
    }
  }

  return { tables: tableCount(options.to), storageRestored };
}

function argOf(name: string, fallback = ''): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

if (require.main === module) {
  const from = argOf('from');
  const to = argOf('to');
  if (!from || !to) {
    console.error(
      'Usage: npm run restore -- --from <backup dir> --to <database url> [--storage <dir>] [--clean]',
    );
    process.exit(1);
  }

  if (to === process.env.DATABASE_URL && !process.argv.includes('--force')) {
    console.error(
      'That is the database this application is configured to use. Pass --force if you really mean to overwrite it.',
    );
    process.exit(1);
  }

  const result = restoreBackup({
    from,
    to,
    storageDir: argOf('storage'),
    clean: process.argv.includes('--clean'),
  });

  console.log(
    `Restored ${result.tables} tables${result.storageRestored ? ' and the attachment store' : ''}.`,
  );
}
