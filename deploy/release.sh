#!/usr/bin/env bash
#
# Release whatever is checked out in this working tree.
#
# The bootstrap script (deploy/bootstrap.sh, installed at /home/nca/deploy.sh)
# fetches the requested commit and then hands over to this file from the code it
# has just fetched, so a change to the release steps ships with the change that
# needs it. It is also safe to run by hand:
#
#     bash /var/www/html/nca-portal/deploy/release.sh
#
# Run as the nca service account. The order is deliberate: nothing that would
# leave the site broken happens before the thing that could fail has succeeded.

set -euo pipefail

ROOT="/var/www/html/nca-portal"
HEALTH="http://127.0.0.1:4000/api/health"
STATE="/home/nca/last-release"

step() { printf '\n== %s\n' "$*"; }

# PM2 reports a process as online the moment it forks, which is well before Nest
# has connected to the database. Health, not uptime, is what says a release worked.
wait_for_health() {
  local attempt
  for attempt in $(seq 1 20); do
    if curl -fsS --max-time 5 "$HEALTH" 2>/dev/null | grep -q '"status":"ok"'; then
      printf '   healthy after %ss\n' "$((attempt * 2))"
      return 0
    fi
    sleep 2
  done
  printf '   the application did not become healthy within 40s\n' >&2
  printf '   last 40 lines:\n' >&2
  pm2 logs nca-backend --lines 40 --nostream >&2 || true
  return 1
}

cd "$ROOT"
RELEASE="$(git rev-parse --short HEAD)"
step "Releasing $RELEASE on $(git rev-parse --abbrev-ref HEAD)"

# Taken before anything touches the schema. Prisma migrations only move forward,
# so a release that has to be undone after the database has changed is a restore
# from this artefact, not a checkout of the previous commit.
step "Backing up the database and attachments"
(cd backend && npm run backup)

step "Backend: dependencies"
(cd backend && npm ci)

step "Backend: Prisma client and migrations"
(cd backend && npx prisma generate && npx prisma migrate deploy)

step "Backend: build"
(cd backend && npm run build)

step "Backend: restart"
pm2 reload nca-backend --update-env
wait_for_health

# The site is built beside the live one and swapped in. Vite empties its output
# directory before it starts writing, so building in place would serve 404s for
# the length of the build rather than for the length of a rename.
step "Frontend: dependencies"
(cd frontend && npm ci)

step "Frontend: build"
(cd frontend && npm run build -- --outDir dist.new --emptyOutDir)

step "Frontend: swap"
cd "$ROOT/frontend"
if [ -d dist.prev ]; then
  # Bounded to this one path. One previous build is kept so a bad release can be
  # put back by hand without waiting for a rebuild; the one before that goes.
  rm -rf ./dist.prev
fi
if [ -d dist ]; then
  mv dist dist.prev
fi
mv dist.new dist

step "Final check"
wait_for_health

printf '%s\n' "$RELEASE" >"$STATE"
step "Released $RELEASE"
