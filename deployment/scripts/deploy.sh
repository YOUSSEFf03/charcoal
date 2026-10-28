#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${FARAH_DEPLOY_ROOT:-/opt/farah-charcoal}"
APP="$ROOT/app"
STATE="$ROOT/deployment-state"
BACKUPS="$ROOT/backups"
ENV_FILE="$ROOT/.env.production"
COMPOSE_FILE="$APP/deployment/compose.production.yml"
TARGET="${1:-}"

if [[ "$EUID" -ne 0 ]]; then
  case "${FARAH_DEPLOY_TEST_MODE:-0}:$ROOT" in
    1:/tmp/farah-deployment-tests.*/*) ;;
    *)
      echo "Run with sudo: sudo /usr/bin/bash $0 <approved-commit>" >&2
      exit 1
      ;;
  esac
fi
if [[ -z "$TARGET" ]]; then
  echo "Usage: $0 <approved-commit>" >&2
  exit 2
fi
for path in "$APP" "$ENV_FILE" "$COMPOSE_FILE"; do
  [[ -e "$path" ]] || { echo "Required path is missing: $path" >&2; exit 1; }
done
[[ -s "$ENV_FILE" ]] || { echo "Production environment file is empty." >&2; exit 1; }
command -v docker >/dev/null || { echo "Docker is not installed." >&2; exit 1; }
docker compose version >/dev/null || { echo "Docker Compose plugin is unavailable." >&2; exit 1; }
command -v flock >/dev/null || { echo "flock is unavailable." >&2; exit 1; }

mkdir -p "$STATE" "$BACKUPS"
chmod 700 "$STATE" "$BACKUPS"
exec 9>"$STATE/deploy.lock"
if ! flock -n 9; then
  echo "Another deployment owns $STATE/deploy.lock." >&2
  exit 75
fi

cd "$APP"
git_safe() { git -c safe.directory="$APP" "$@"; }
if ! git_safe cat-file -e "$TARGET^{commit}"; then
  echo "Unknown commit: $TARGET" >&2
  exit 1
fi
PREVIOUS_COMMIT="$(git_safe rev-parse HEAD)"
PREVIOUS_TAG="$(cat "$STATE/current-commit" 2>/dev/null || true)"
PREVIOUS_PREVIOUS_TAG="$(cat "$STATE/previous-commit" 2>/dev/null || true)"
TARGET="$(git_safe rev-parse "$TARGET")"
if [[ -n "$(git_safe status --porcelain)" ]]; then
  if { printf '%s\n' "$TARGET" > "$STATE/failed-commit.tmp" && mv "$STATE/failed-commit.tmp" "$STATE/failed-commit"; }; then
    echo "Recorded $TARGET as failed until the checkout is clean or a newer commit arrives." >&2
  else
    echo "Checkout is dirty and the failed commit marker could not be written." >&2
  fi
  echo "Refusing to deploy with a dirty application checkout." >&2
  exit 1
fi

# A poller may have read the old marker just before another deployment
# completed. Recheck under the single lock before doing any work.
if [[ "$TARGET" == "$PREVIOUS_TAG" ]]; then
  echo "Commit $TARGET is already deployed."
  exit 0
fi

DEPLOY_IMAGE_TAG="$TARGET"
export DEPLOY_IMAGE_TAG PROD_ENV_FILE="$ENV_FILE"
MIGRATION_ATTEMPTED=0
SERVICE_UPDATE_ATTEMPTED=0
BACKUP=""
BACKUP_VALID=0

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

deployment_failed() {
  local original_status="$1"
  local failed_command="$2"
  local failed_line="$3"
  local rollback_ok=0

  trap - ERR
  set +e
  echo "Deployment of $TARGET failed at line $failed_line (status $original_status): $failed_command" >&2
  if ! { printf '%s\n' "$TARGET" > "$STATE/failed-commit.tmp" && mv "$STATE/failed-commit.tmp" "$STATE/failed-commit"; }; then
    echo "Could not record failed commit $TARGET; inspect disk space and deployment state." >&2
  fi

  if [[ -n "$PREVIOUS_PREVIOUS_TAG" ]]; then
    if ! { printf '%s\n' "$PREVIOUS_PREVIOUS_TAG" > "$STATE/previous-commit.tmp" && mv "$STATE/previous-commit.tmp" "$STATE/previous-commit"; }; then
      echo "Could not restore the previous-image marker; inspect deployment state." >&2
    fi
  elif ! rm -f "$STATE/previous-commit" "$STATE/previous-commit.tmp"; then
    echo "Could not restore the previous-image marker; inspect deployment state." >&2
  fi

  if [[ -n "$BACKUP" && "$BACKUP_VALID" -eq 1 ]]; then
    echo "Database backup retained at $BACKUP" >&2
  elif [[ -n "$BACKUP" ]]; then
    rm -f "$BACKUP"
    echo "Database backup creation or validation failed; no verified backup is available." >&2
  fi

  if [[ "$SERVICE_UPDATE_ATTEMPTED" -eq 1 ]]; then
    if [[ ! "$PREVIOUS_TAG" =~ ^[[:xdigit:]]{40}$ ]]; then
      echo "No valid previous image tag is recorded; automatic image rollback is unavailable." >&2
    elif ! docker image inspect \
      "farah-charcoal-backend:$PREVIOUS_TAG" \
      "farah-charcoal-frontend:$PREVIOUS_TAG" >/dev/null 2>&1; then
      echo "Previous images for $PREVIOUS_TAG are missing; refusing to rebuild during rollback." >&2
      echo "Use the retained database backup and deployment recovery procedure." >&2
    else
      export DEPLOY_IMAGE_TAG="$PREVIOUS_TAG"
      if compose up -d --no-build --wait --wait-timeout 180 backend frontend webhook-proxy && \
        curl --fail --silent --show-error --retry 3 --retry-delay 2 --retry-connrefused http://127.0.0.1:8080/health >/dev/null; then
        rollback_ok=1
        echo "Previous application images $PREVIOUS_TAG are running and passed the health check." >&2
      else
        echo "Previous image rollback failed health verification; follow deployment/README-FIRST.md recovery steps." >&2
      fi
    fi
  elif [[ "$MIGRATION_ATTEMPTED" -eq 1 ]]; then
    echo "Migration failed before service replacement. No database restore was attempted; inspect migration state and use the retained backup only with operator authorization." >&2
  else
    echo "Services were not replaced; the previous deployment should still be serving." >&2
  fi

  if ! git_safe checkout --detach "$PREVIOUS_COMMIT" >/dev/null 2>&1; then
    echo "Could not restore the checkout to $PREVIOUS_COMMIT; inspect the application repository." >&2
  fi

  # The successful marker is written only after the new release passes health.
  # Keep the previous marker unchanged, regardless of rollback outcome.
  if [[ "$rollback_ok" -eq 1 ]]; then
    echo "Application rollback completed; the database schema was not changed back." >&2
  fi
  exit "$original_status"
}
trap 'deployment_failed "$?" "$BASH_COMMAND" "$LINENO"' ERR

perform_deployment() {
  git_safe checkout --detach "$TARGET"
  compose config --quiet
  compose build backend frontend

  # Ensure PostgreSQL is ready, then create and verify a unique backup before
  # attempting any migration. It is never overwritten or automatically pruned.
  compose up -d --wait --wait-timeout 180 db
  local stamp
  stamp="$(date -u +%Y%m%dT%H%M%S%NZ)"
  BACKUP="$BACKUPS/${stamp}-${PREVIOUS_TAG:-initial}.sql.gz"
  umask 077
  compose exec -T db sh -ec 'pg_dump --no-owner --no-acl -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip -c > "$BACKUP"
  gzip -t "$BACKUP"
  [[ -s "$BACKUP" ]]
  BACKUP_VALID=1
  echo "Database backup created and verified: $BACKUP"

  # Migrations are explicit and only run after a verified backup.
  MIGRATION_ATTEMPTED=1
  compose run --rm --no-deps --entrypoint sh backend -ec 'cd /app/apps/backend && npx --no-install prisma migrate deploy --schema prisma/schema.prisma'

  SERVICE_UPDATE_ATTEMPTED=1
  compose up -d --wait --wait-timeout 180 backend frontend webhook-proxy
  curl --fail --silent --show-error --retry 10 --retry-delay 3 --retry-connrefused http://127.0.0.1:8080/health >/dev/null

  if [[ -n "$PREVIOUS_TAG" ]]; then
    printf '%s\n' "$PREVIOUS_TAG" > "$STATE/previous-commit.tmp"
    mv "$STATE/previous-commit.tmp" "$STATE/previous-commit"
  else
    rm -f "$STATE/previous-commit" "$STATE/previous-commit.tmp"
  fi
  rm -f "$STATE/failed-commit" "$STATE/failed-commit.tmp"
  echo "Health verified; recording the successful deployment."
  printf '%s\n' "$TARGET" > "$STATE/current-commit.tmp"
  mv "$STATE/current-commit.tmp" "$STATE/current-commit"
}

perform_deployment
