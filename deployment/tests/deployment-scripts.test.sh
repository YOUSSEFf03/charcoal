#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_BASE="${TMPDIR:-/tmp}"
TMP_ROOT="$(mktemp -d "$TMP_BASE/farah-deployment-tests.XXXXXX")"
REAL_FLOCK="$(command -v flock || true)"
REAL_GZIP="$(command -v gzip)"
cleanup() {
  case "$TMP_ROOT" in
    "$TMP_BASE"/farah-deployment-tests.*) rm -rf -- "$TMP_ROOT" ;;
    *) echo "Refusing to remove unexpected test path: $TMP_ROOT" >&2; exit 1 ;;
  esac
}
trap cleanup EXIT

pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
assert_eq() { [[ "$1" == "$2" ]] || fail "$3 (expected '$2', got '$1')"; }
assert_file_value() {
  local actual
  actual="$(cat "$1" 2>/dev/null || true)"
  assert_eq "$actual" "$2" "$3"
}

new_fixture() {
  local name="$1"
  FIXTURE="$TMP_ROOT/$name"
  mkdir -p "$FIXTURE/seed/deployment/scripts" "$FIXTURE/seed/deployment" "$FIXTURE/bin"
  cp "$SOURCE_ROOT/deployment/scripts/deploy.sh" "$FIXTURE/seed/deployment/scripts/deploy.sh"
  cp "$SOURCE_ROOT/deployment/scripts/deploy-poll.sh" "$FIXTURE/seed/deployment/scripts/deploy-poll.sh"
  printf 'name: test\n' > "$FIXTURE/seed/deployment/compose.production.yml"
  printf 'placeholder=true\n' > "$FIXTURE/.env.production"
  git -C "$FIXTURE/seed" init -q -b main
  git -C "$FIXTURE/seed" config user.email deployment-tests@example.invalid
  git -C "$FIXTURE/seed" config user.name deployment-tests
  git -C "$FIXTURE/seed" add deployment
  git -C "$FIXTURE/seed" commit -qm initial
  OLD_SHA="$(git -C "$FIXTURE/seed" rev-parse HEAD)"
  git clone -q --bare "$FIXTURE/seed" "$FIXTURE/remote.git"
  git clone -q "$FIXTURE/remote.git" "$FIXTURE/root-app"
  mkdir -p "$FIXTURE/root/deployment-state" "$FIXTURE/root/backups"
  cp "$FIXTURE/.env.production" "$FIXTURE/root/.env.production"
  # The deploy script expects these paths below ROOT/app.
  mv "$FIXTURE/root-app" "$FIXTURE/root/app"
  CALL_LOG="$FIXTURE/calls.log"
  LOCK_LOG="$FIXTURE/locks.log"
  export CALL_LOG LOCK_LOG REAL_FLOCK REAL_GZIP

  cat > "$FIXTURE/bin/docker" <<'MOCK_DOCKER'
#!/usr/bin/env bash
printf 'tag=%s args=%s\n' "${DEPLOY_IMAGE_TAG:-}" "$*" >> "$CALL_LOG"
case " $* " in
  *" compose version "*) exit 0 ;;
  *" build backend frontend "*) [[ "${FAIL_BUILD:-0}" == 1 ]] && exit 44; exit 0 ;;
  *" exec -T db "*) [[ "${FAIL_DUMP:-0}" == 1 ]] && exit 46; printf 'mocked SQL dump;\n'; exit 0 ;;
  *" run --rm "*) [[ "${FAIL_MIGRATION:-0}" == 1 ]] && exit 47; exit 0 ;;
  *" image inspect "*) [[ "${MISSING_PREVIOUS_IMAGES:-0}" == 1 ]] && exit 1; exit 0 ;;
  *" up -d --no-build "*) [[ "${FAIL_ROLLBACK_UP:-0}" == 1 ]] && exit 58; exit 0 ;;
  *" up -d "*) exit 0 ;;
  *) exit 0 ;;
esac
MOCK_DOCKER
  cat > "$FIXTURE/bin/curl" <<'MOCK_CURL'
#!/usr/bin/env bash
printf 'curl\n' >> "$CALL_LOG"
if [[ "${FAIL_HEALTH_ONCE:-0}" == 1 && ! -e "$CALL_LOG.health-failed" ]]; then
  : > "$CALL_LOG.health-failed"
  exit 22
fi
[[ "${FAIL_HEALTH_ALWAYS:-0}" == 1 ]] && exit 22
exit 0
MOCK_CURL
  cat > "$FIXTURE/bin/flock" <<'MOCK_FLOCK'
#!/usr/bin/env bash
printf 'flock %s\n' "$*" >> "$LOCK_LOG"
if [[ -n "$REAL_FLOCK" ]]; then exec "$REAL_FLOCK" "$@"; fi
[[ "${MOCK_LOCK_BUSY:-0}" == 1 ]] && exit 1
exit 0
MOCK_FLOCK
  cat > "$FIXTURE/bin/gzip" <<'MOCK_GZIP'
#!/usr/bin/env bash
if [[ "${1:-}" == -t && "${FAIL_GZIP_TEST:-0}" == 1 ]]; then exit 49; fi
exec "$REAL_GZIP" "$@"
MOCK_GZIP
  chmod +x "$FIXTURE/bin/docker" "$FIXTURE/bin/curl" "$FIXTURE/bin/flock" "$FIXTURE/bin/gzip"
  TEST_PATH="$FIXTURE/bin:$PATH"
  export TEST_PATH
}

advance_main() {
  local fixture="$1"
  printf 'second\n' > "$fixture/seed/second.txt"
  git -C "$fixture/seed" add second.txt
  git -C "$fixture/seed" commit -qm second
  git -C "$fixture/seed" push -q "$fixture/remote.git" main
  git -C "$fixture/root/app" fetch -q origin main
  NEW_SHA="$(git -C "$fixture/root/app" rev-parse origin/main)"
}

run_deploy() {
  local fixture="$1" target="$2"
env PATH="$TEST_PATH" FARAH_DEPLOY_ROOT="$fixture/root" FARAH_DEPLOY_TEST_MODE=1 \
    MOCK_LOCK_BUSY="${MOCK_LOCK_BUSY:-0}" bash "$fixture/root/app/deployment/scripts/deploy.sh" "$target"
}

# The poller itself takes no lock; its child deployment takes exactly one.
new_fixture poller
advance_main "$FIXTURE"
: > "$CALL_LOG"
: > "$LOCK_LOG"
env PATH="$TEST_PATH" FARAH_DEPLOY_ROOT="$FIXTURE/root" FARAH_DEPLOY_TEST_MODE=1 \
  bash "$FIXTURE/root/app/deployment/scripts/deploy-poll.sh"
assert_file_value "$FIXTURE/root/deployment-state/current-commit" "$NEW_SHA" "poller reaches deploy and records success"
assert_eq "$(wc -l < "$LOCK_LOG" | tr -d ' ')" 1 "poller deployment uses exactly one lock"
grep -q 'build backend frontend' "$CALL_LOG" || fail "poller did not reach the mocked build"
pass "poller reaches deployment with a single lock owner"

# A manual deployment contends on that same lock and does no build work.
new_fixture contention
TARGET="$(git -C "$FIXTURE/root/app" rev-parse HEAD)"
set +e
if [[ -n "$REAL_FLOCK" ]]; then
  exec 8>"$FIXTURE/root/deployment-state/deploy.lock"
  "$REAL_FLOCK" -n 8
  run_deploy "$FIXTURE" "$TARGET" >/dev/null 2>&1
  status=$?
  exec 8>&-
else
  MOCK_LOCK_BUSY=1 run_deploy "$FIXTURE" "$TARGET" >/dev/null 2>&1
  status=$?
fi
set -e
assert_eq "$status" 75 "lock contention returns the designated busy status"
if grep -q 'build backend frontend' "$CALL_LOG"; then fail "deployment built while another owner held the lock"; fi
pass "lock contention blocks manual deployment safely"

# Successful state and previous-image markers are written after health succeeds.
new_fixture state
advance_main "$FIXTURE"
printf '%s\n' "$OLD_SHA" > "$FIXTURE/root/deployment-state/current-commit"
run_deploy "$FIXTURE" "$NEW_SHA" >/dev/null
assert_file_value "$FIXTURE/root/deployment-state/current-commit" "$NEW_SHA" "successful deployment marker"
assert_file_value "$FIXTURE/root/deployment-state/previous-commit" "$OLD_SHA" "previous image marker"
[[ ! -e "$FIXTURE/root/deployment-state/failed-commit" ]] || fail "success left a failed-commit marker"
pass "successful deployment updates commit markers after health"

# Migration failures preserve their original exit status and never update success state.
new_fixture migration
advance_main "$FIXTURE"
printf '%s\n' "$OLD_SHA" > "$FIXTURE/root/deployment-state/current-commit"
set +e
FAIL_MIGRATION=1 env PATH="$TEST_PATH" FARAH_DEPLOY_ROOT="$FIXTURE/root" FARAH_DEPLOY_TEST_MODE=1 FAIL_MIGRATION=1 \
  bash "$FIXTURE/root/app/deployment/scripts/deploy.sh" "$NEW_SHA" >/dev/null 2>&1
status=$?
set -e
assert_eq "$status" 47 "migration failure status is preserved"
assert_file_value "$FIXTURE/root/deployment-state/current-commit" "$OLD_SHA" "migration failure current marker"
assert_file_value "$FIXTURE/root/deployment-state/failed-commit" "$NEW_SHA" "migration failure marker"
[[ -n "$(find "$FIXTURE/root/backups" -type f -name '*.sql.gz' -print -quit)" ]] || fail "migration failure did not retain its backup"
if grep -q 'image inspect' "$CALL_LOG"; then fail "migration failure attempted an unnecessary image rollback"; fi
pass "migration failure retains backup and preserves status/state"

# A failed dump pipeline removes its partial gzip and never claims a backup exists.
new_fixture backup
advance_main "$FIXTURE"
printf '%s\n' "$OLD_SHA" > "$FIXTURE/root/deployment-state/current-commit"
set +e
env PATH="$TEST_PATH" FARAH_DEPLOY_ROOT="$FIXTURE/root" FARAH_DEPLOY_TEST_MODE=1 FAIL_DUMP=1 \
  bash "$FIXTURE/root/app/deployment/scripts/deploy.sh" "$NEW_SHA" >/dev/null 2>&1
status=$?
set -e
assert_eq "$status" 46 "backup pipeline failure status is preserved"
assert_file_value "$FIXTURE/root/deployment-state/current-commit" "$OLD_SHA" "backup failure current marker"
[[ -z "$(find "$FIXTURE/root/backups" -type f -print -quit)" ]] || fail "invalid partial backup was retained as recovery data"
pass "backup failure removes partial output and records no false success"

# An archive that fails gzip validation is also removed and never marked usable.
new_fixture backup-validation
advance_main "$FIXTURE"
printf '%s\n' "$OLD_SHA" > "$FIXTURE/root/deployment-state/current-commit"
set +e
env PATH="$TEST_PATH" FARAH_DEPLOY_ROOT="$FIXTURE/root" FARAH_DEPLOY_TEST_MODE=1 FAIL_GZIP_TEST=1 \
  bash "$FIXTURE/root/app/deployment/scripts/deploy.sh" "$NEW_SHA" >/dev/null 2>&1
status=$?
set -e
assert_eq "$status" 49 "backup validation failure status is preserved"
[[ -z "$(find "$FIXTURE/root/backups" -type f -print -quit)" ]] || fail "invalid compressed backup was retained"
assert_file_value "$FIXTURE/root/deployment-state/current-commit" "$OLD_SHA" "backup validation current marker"
pass "backup validation failure removes the invalid archive"

# A failed post-deploy health check rolls back to exact prior tags, with no build.
new_fixture health
advance_main "$FIXTURE"
printf '%s\n' "$OLD_SHA" > "$FIXTURE/root/deployment-state/current-commit"
set +e
env PATH="$TEST_PATH" FARAH_DEPLOY_ROOT="$FIXTURE/root" FARAH_DEPLOY_TEST_MODE=1 FAIL_HEALTH_ONCE=1 \
  bash "$FIXTURE/root/app/deployment/scripts/deploy.sh" "$NEW_SHA" >/dev/null 2>&1
status=$?
set -e
assert_eq "$status" 22 "health failure status is preserved after rollback"
assert_file_value "$FIXTURE/root/deployment-state/current-commit" "$OLD_SHA" "health failure never records success"
assert_file_value "$FIXTURE/root/deployment-state/failed-commit" "$NEW_SHA" "health failure marker"
grep -q "tag=$OLD_SHA args=compose --env-file .* up -d --no-build" "$CALL_LOG" || fail "rollback did not use the exact old image tag without rebuilding"
grep -q "args=image inspect farah-charcoal-backend:$OLD_SHA farah-charcoal-frontend:$OLD_SHA" "$CALL_LOG" || fail "rollback did not verify both exact old image tags"
pass "health failure restores pinned images without rebuilding or false success"

# A failed rollback reports recovery needs but still returns the original health error.
new_fixture rollback-failure
advance_main "$FIXTURE"
printf '%s\n' "$OLD_SHA" > "$FIXTURE/root/deployment-state/current-commit"
set +e
env PATH="$TEST_PATH" FARAH_DEPLOY_ROOT="$FIXTURE/root" FARAH_DEPLOY_TEST_MODE=1 FAIL_HEALTH_ONCE=1 FAIL_ROLLBACK_UP=1 \
  bash "$FIXTURE/root/app/deployment/scripts/deploy.sh" "$NEW_SHA" > "$FIXTURE/rollback-failure.log" 2>&1
status=$?
set -e
assert_eq "$status" 22 "rollback failure does not replace the health failure status"
assert_file_value "$FIXTURE/root/deployment-state/current-commit" "$OLD_SHA" "rollback failure current marker"
grep -q 'Previous image rollback failed health verification' "$FIXTURE/rollback-failure.log" || fail "rollback failure recovery message absent"
pass "rollback failure preserves the triggering status and state"

# Previously failed remote commits are skipped without invoking deploy.
new_fixture failed-poller
advance_main "$FIXTURE"
printf '%s\n' "$NEW_SHA" > "$FIXTURE/root/deployment-state/failed-commit"
: > "$CALL_LOG"
env PATH="$TEST_PATH" FARAH_DEPLOY_ROOT="$FIXTURE/root" FARAH_DEPLOY_TEST_MODE=1 \
  bash "$FIXTURE/root/app/deployment/scripts/deploy-poll.sh" >/dev/null
if grep -q 'build backend frontend\|run --rm' "$CALL_LOG"; then fail "poller retried a previously failed commit"; fi
pass "poller skips a commit already recorded as failed"

# Missing old images must not trigger Compose's implicit build behavior.
new_fixture missing-image
advance_main "$FIXTURE"
printf '%s\n' "$OLD_SHA" > "$FIXTURE/root/deployment-state/current-commit"
set +e
env PATH="$TEST_PATH" FARAH_DEPLOY_ROOT="$FIXTURE/root" FARAH_DEPLOY_TEST_MODE=1 FAIL_HEALTH_ONCE=1 MISSING_PREVIOUS_IMAGES=1 \
  bash "$FIXTURE/root/app/deployment/scripts/deploy.sh" "$NEW_SHA" > "$FIXTURE/missing-image.log" 2>&1
status=$?
set -e
assert_eq "$status" 22 "missing image preserves original health failure"
grep -q 'Previous images .* are missing; refusing to rebuild' "$FIXTURE/missing-image.log" || fail "missing-image recovery message absent"
if grep -q "tag=$OLD_SHA args=.* compose up" "$CALL_LOG"; then fail "missing-image rollback attempted Compose up"; fi
pass "missing previous images produce a clear no-rebuild recovery message"

# An image build failure occurs before any service update or migration.
new_fixture build-failure
advance_main "$FIXTURE"
printf '%s\n' "$OLD_SHA" > "$FIXTURE/root/deployment-state/current-commit"
set +e
env PATH="$TEST_PATH" FARAH_DEPLOY_ROOT="$FIXTURE/root" FARAH_DEPLOY_TEST_MODE=1 FAIL_BUILD=1 \
  bash "$FIXTURE/root/app/deployment/scripts/deploy.sh" "$NEW_SHA" > "$FIXTURE/build-failure.log" 2>&1
status=$?
set -e
assert_eq "$status" 44 "image build failure status is preserved"
assert_file_value "$FIXTURE/root/deployment-state/current-commit" "$OLD_SHA" "build failure current marker"
grep -q 'Services were not replaced; the previous deployment should still be serving' "$FIXTURE/build-failure.log" || fail "image-build failure recovery message absent"
pass "image build failure leaves prior services and success marker intact"

printf 'All deployment script tests passed.\n'
