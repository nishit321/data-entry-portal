#!/usr/bin/env bash
#
# Reference copy. The live copy is installed on the server at /home/nca/deploy.sh
# and named as the forced command in the nca account's ~/.ssh/authorized_keys, so
# the key CI holds can do this and nothing else — no shell, no other command.
#
#     command="/home/nca/deploy.sh",no-port-forwarding,no-pty ssh-ed25519 AAAA... ci@github
#
# Install it by hand and keep it there. It is the one piece that cannot live in
# the repository, because it is what fetches the repository.
#
#     bash /home/nca/deploy.sh          # releases origin/main
#     SSH_ORIGINAL_COMMAND=abc1234 bash /home/nca/deploy.sh    # releases one commit

set -euo pipefail

ROOT="/var/www/html/nca-portal"
LOCK="/home/nca/.deploy.lock"

# The ref arrives over SSH from CI, so it is checked rather than trusted.
REF="${SSH_ORIGINAL_COMMAND:-main}"
if ! [[ "$REF" =~ ^[A-Za-z0-9._/-]{1,100}$ ]]; then
  echo "refusing an unexpected ref: $REF" >&2
  exit 2
fi

# Two releases at once would interleave npm installs and migrations. The second
# one is refused rather than queued, because CI already queues them.
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "another deployment is already running" >&2
  exit 3
fi

cd "$ROOT"

# Anything modified on the server by hand is a decision somebody made, and a
# deployment is not the place to discard it silently.
if [ -n "$(git status --porcelain)" ]; then
  echo "the working tree has local changes; refusing to deploy" >&2
  git status --short >&2
  exit 4
fi

echo "== Current release: $(git rev-parse --short HEAD)"
git fetch --prune origin

if [ "$REF" = "main" ]; then
  git checkout main
  # Fast-forward only. A diverged branch stops the deployment instead of being
  # reset over, which is the difference between a failed deploy and a lost commit.
  git merge --ff-only origin/main
else
  # A rollback, or a release of one specific commit.
  git checkout --detach "$REF"
fi

exec bash "$ROOT/deploy/release.sh"
