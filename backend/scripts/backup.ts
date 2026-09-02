/* eslint-disable no-console -- a command-line tool reports by printing */
/**
 * Take a backup: the database and the attachment blobs, together (§9, OPERATIONS.md).
 *
 * They go together deliberately. `submission_attachments` holds only an opaque `storageKey`; the
 * file itself lives under `STORAGE_DIR`. A database-only backup restores a portal where every
 * supporting document an operator ever filed is a broken link, and the failure is invisible until
 * somebody opens a return from three years ago. So one command produces one artefact containing
 * both, and the restore puts both back.
 *
 *   npm run backup -- --out ../backups
 *
 * The dump is PostgreSQL's custom format, which `pg_restore` can read selectively and in parallel.
 * `pg_dump` is expected on the PATH; set `PG_BIN` when it is installed somewhere else, as it is on
 * a default Windows install.
 */
// These run outside Nest, so the environment the application reads has to be loaded here.
import 'dotenv/config';
import { execFileSync } from 'child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

export interface BackupResult {
  /** The directory holding this backup. */
  dir: string;
  dumpFile: string;
  storageDir: string | null;
  bytes: number;
}

/** Where the Postgres client tools live. Empty means "on the PATH", which is the usual case. */
export function pgBin(name: string): string {
  const dir = process.env.PG_BIN?.trim();
  return dir ? join(dir, name) : name;
}

/**
 * Query parameters libpq understands. Everything else is dropped.
 *
 * A Prisma connection string carries settings the Postgres client tools have never heard of —
 * `schema`, `connection_limit`, `pgbouncer` — and `pg_dump` does not ignore an unknown parameter,
 * it refuses to start. Handing it the application's own `DATABASE_URL` therefore fails on the very
 * first backup, which is precisely the sort of thing that stays hidden until the night somebody
 * needs a restore. An allowlist rather than a list of Prisma's own additions, so a setting nobody
 * anticipated cannot break the backup either.
 */
const LIBPQ_PARAMS = new Set([
  'sslmode',
  'sslcert',
  'sslkey',
  'sslrootcert',
  'connect_timeout',
  'application_name',
  'options',
  'target_session_attrs',
]);

/**
 * A Prisma connection string as the Postgres client tools want it.
 *
 * The schema is dropped rather than translated: `pg_dump` defaults to dumping every schema, which
 * is what a backup should do anyway. Restricting it to `public` would quietly leave anything
 * outside that schema out of the backup.
 */
export function toLibpqUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  for (const key of [...url.searchParams.keys()]) {
    if (!LIBPQ_PARAMS.has(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

/** A filesystem-safe stamp, so backups sort by name in the order they were taken. */
function stamp(at = new Date()): string {
  return at.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

function directorySize(dir: string): number {
  let total = 0;
  const walk = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) walk(child);
      else total += statSync(child).size;
    }
  };
  if (existsSync(dir)) walk(dir);
  return total;
}

export function takeBackup(options: {
  databaseUrl: string;
  storageDir: string;
  outDir: string;
  label?: string;
}): BackupResult {
  const dir = resolve(options.outDir, `${stamp()}${options.label ? `_${options.label}` : ''}`);
  mkdirSync(dir, { recursive: true });

  const dumpFile = join(dir, 'database.dump');
  execFileSync(
    pgBin('pg_dump'),
    [
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--file',
      dumpFile,
      toLibpqUrl(options.databaseUrl),
    ],
    { stdio: 'pipe' },
  );

  // The blobs. Copied rather than archived so a restore is a plain file copy on any platform, and
  // so an operator's document can be pulled out of a backup without special tools.
  let storageDir: string | null = null;
  const source = resolve(options.storageDir);
  if (existsSync(source)) {
    storageDir = join(dir, 'storage');
    cpSync(source, storageDir, { recursive: true });
  }

  // A manifest, so a restore can check it is putting back what was taken and a person reading a
  // directory of backups can tell what each one is.
  const manifest = {
    takenAt: new Date().toISOString(),
    database: options.databaseUrl.replace(/\/\/[^@]*@/, '//***@'),
    dumpFile: 'database.dump',
    storageDir: storageDir ? 'storage' : null,
    storageBytes: storageDir ? directorySize(storageDir) : 0,
    dumpBytes: statSync(dumpFile).size,
  };
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return {
    dir,
    dumpFile,
    storageDir,
    bytes: manifest.dumpBytes + manifest.storageBytes,
  };
}

function argOf(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

if (require.main === module) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set. Refusing to guess which database to back up.');
    process.exit(1);
  }

  const result = takeBackup({
    databaseUrl,
    storageDir: argOf('storage', process.env.STORAGE_DIR ?? 'storage'),
    outDir: argOf('out', 'backups'),
    label: argOf('label', ''),
  });

  const mb = (result.bytes / 1024 / 1024).toFixed(1);
  console.log(`Backup written to ${result.dir} (${mb} MB).`);
  if (!result.storageDir) {
    console.log('No attachment store was found, so this backup contains the database only.');
  }
}
