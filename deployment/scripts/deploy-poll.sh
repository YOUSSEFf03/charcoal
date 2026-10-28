#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${FARAH_DEPLOY_ROOT:-/opt/farah-charcoal}"
APP="$ROOT/app"
STATE="$ROOT/deployment-state"
mkdir -p "$STATE"
cd "$APP"

# deploy.sh owns the only deployment lock. It also takes that lock for manual
# runs, then rechecks the commit marker while holding it.
git -c safe.directory="$APP" fetch --prune origin main
REMOTE="$(git -c safe.directory="$APP" rev-parse origin/main)"
CURRENT="$(cat "$STATE/current-commit" 2>/dev/null || true)"
FAILED="$(cat "$STATE/failed-commit" 2>/dev/null || true)"
if [[ "$REMOTE" == "$CURRENT" ]]; then exit 0; fi
if [[ "$REMOTE" == "$FAILED" ]]; then
  echo "Commit $REMOTE previously failed; waiting for a newer main commit or a manual retry."
  exit 0
fi

echo "Deploying approved origin/main commit $REMOTE"
if bash "$APP/deployment/scripts/deploy.sh" "$REMOTE"; then
  exit 0
else
  status=$?
  if [[ "$status" -eq 75 ]]; then
    echo "Deployment lock is held; another manual or polled deployment owns this run."
    exit 0
  fi
  exit "$status"
fi
