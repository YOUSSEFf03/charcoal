#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="/opt/farah-charcoal"
APP="$ROOT/app"
STATE="$ROOT/deployment-state"
mkdir -p "$STATE"
exec 9>"$STATE/deploy.lock"
flock -n 9 || exit 0
cd "$APP"
git config --global --add safe.directory "$APP"
git fetch origin main
REMOTE="$(git rev-parse origin/main)"
CURRENT="$(cat "$STATE/current-commit" 2>/dev/null || true)"
if [[ "$REMOTE" == "$CURRENT" ]]; then exit 0; fi
echo "New main commit detected: $REMOTE"
"$APP/deployment/scripts/deploy.sh"
