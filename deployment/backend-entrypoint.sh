#!/bin/sh
set -eu

cd /app/apps/backend

# Migrations are applied explicitly by deploy.sh, after it has created a
# database backup. Keeping startup side-effect free makes restarts safe.
exec node dist/src/main.js
