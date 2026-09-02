/* eslint-disable no-console -- a command-line tool reports by printing */
/**
 * Print the route census: every endpoint the application serves, and who can reach it.
 *
 *   npm run routes
 *   npm run routes -- --open      only the ones that are not role-guarded
 *
 * The same reading the tests use (`route-inventory.e2e-spec.ts` fails on an unexplained one), so
 * this cannot drift from what is enforced. It exists because "show me every way into the system"
 * is a fair question from a security reviewer, and answering it by reading thirty-one controllers
 * is how things get missed.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { inventoryRoutes } from '../src/common/utils/route-inventory.util';

const LABEL = {
  public: 'PUBLIC       ',
  'any-signed-in': 'any signed in',
  roles: '',
} as const;

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.init();

  const routes = inventoryRoutes(app);
  const openOnly = process.argv.includes('--open');
  const shown = openOnly ? routes.filter((r) => r.access !== 'roles') : routes;

  const width = Math.max(...shown.map((r) => r.signature.length));
  for (const route of shown) {
    const who = route.machine
      ? 'machine credential'
      : (LABEL[route.access] || route.roles.join(', ')).trim();
    console.log(`  ${route.signature.padEnd(width)}  ${who}`);
  }

  // Counted over every route, not over whatever `--open` chose to show. A total taken from a
  // filtered list beside a total taken from the whole one is a line that reads as a fact and is not.
  const counts = routes.reduce<Record<string, number>>((acc, r) => {
    acc[r.access] = (acc[r.access] ?? 0) + 1;
    return acc;
  }, {});
  console.log('');
  console.log(
    `  ${routes.length} routes: ${counts.roles ?? 0} role-guarded, ` +
      `${counts['any-signed-in'] ?? 0} open to any signed-in user, ${counts.public ?? 0} public.`,
  );
  console.log('  Every one of the last two is explained in test/route-inventory.e2e-spec.ts.');

  await app.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
