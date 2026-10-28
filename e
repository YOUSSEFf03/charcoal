warning: in the working copy of '.gitignore', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'deployment/.env.production.example', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'deployment/backend-entrypoint.sh', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'deployment/scripts/deploy.sh', LF will be replaced by CRLF the next time Git touches it
[1mdiff --git a/.gitignore b/.gitignore[m
[1mindex 25b1396..2c67dd7 100644[m
[1m--- a/.gitignore[m
[1m+++ b/.gitignore[m
[36m@@ -35,3 +35,7 @@[m [mnpm-debug.log*[m
 [m
 # TypeScript[m
 *.tsbuildinfo[m
[32m+[m[32m.env.production[m
[32m+[m[32mdeployment/.deploy-config[m
[32m+[m[32mdeployment/backups/[m
[32m+[m[32mdeployment-backup-*/[m
[1mdiff --git a/deployment/.env.production.example b/deployment/.env.production.example[m
[1mindex b7165f5..cacd982 100644[m
[1m--- a/deployment/.env.production.example[m
[1m+++ b/deployment/.env.production.example[m
[36m@@ -19,7 +19,6 @@[m [mCLERK_JWKS_URL=https://api.clerk.com/v1/jwks[m
 [m
 # Browser uses same-origin /api/v1, so no public API URL is needed.[m
 VITE_API_URL=/api/v1[m
[31m-CORS_ORIGINS=[m
 [m
 # Optional integrations; leave blank if not used.[m
 TRAQO_API_KEY=[m
[1mdiff --git a/deployment/backend-entrypoint.sh b/deployment/backend-entrypoint.sh[m
[1mindex ea4e1cb..36b92ac 100644[m
[1m--- a/deployment/backend-entrypoint.sh[m
[1m+++ b/deployment/backend-entrypoint.sh[m
[36m@@ -1,6 +1,10 @@[m
 #!/bin/sh[m
 set -eu[m
[31m-cd /app[m
[31m-# Migrations are serialized by Compose's single backend replica.[m
[31m-npm exec --workspace=@charcoal/backend -- prisma migrate deploy --schema prisma/schema.prisma[m
[31m-exec node apps/backend/dist/src/main.js[m
[32m+[m
[32m+[m[32mcd /app/apps/backend[m
[32m+[m
[32m+[m[32m# Apply pending migrations before starting the API.[m
[32m+[m[32mnpx prisma migrate deploy --schema prisma/schema.prisma[m
[32m+[m
[32m+[m[32m# Start the compiled NestJS application.[m
[32m+[m[32mexec node dist/src/main.js[m
[1mdiff --git a/deployment/scripts/deploy.sh b/deployment/scripts/deploy.sh[m
[1mindex e69de29..07a3205 100644[m
[1m--- a/deployment/scripts/deploy.sh[m
[1m+++ b/deployment/scripts/deploy.sh[m
[36m@@ -0,0 +1,38 @@[m
[32m+[m[32m﻿#!/usr/bin/env bash[m
[32m+[m[32mset -Eeuo pipefail[m
[32m+[m
[32m+[m[32mROOT="/opt/farah-charcoal"[m
[32m+[m[32mAPP="$ROOT/app"[m
[32m+[m[32mENV_FILE="$ROOT/.env.production"[m
[32m+[m[32mCOMPOSE_FILE="$APP/deployment/compose.production.yml"[m
[32m+[m
[32m+[m[32mif [[ "$EUID" -ne 0 ]]; then[m
[32m+[m[32m  echo "Run with sudo: sudo $0"[m
[32m+[m[32m  exit 1[m
[32m+[m[32mfi[m
[32m+[m
[32m+[m[32mfor path in "$APP" "$ENV_FILE" "$COMPOSE_FILE"; do[m
[32m+[m[32m  if [[ ! -e "$path" ]]; then[m
[32m+[m[32m    echo "Required path is missing: $path"[m
[32m+[m[32m    exit 1[m
[32m+[m[32m  fi[m
[32m+[m[32mdone[m
[32m+[m
[32m+[m[32mif [[ ! -s "$ENV_FILE" ]]; then[m
[32m+[m[32m  echo "Production environment file is empty."[m
[32m+[m[32m  exit 1[m
[32m+[m[32mfi[m
[32m+[m
[32m+[m[32mif ! command -v docker >/dev/null 2>&1; then[m
[32m+[m[32m  echo "Docker is not installed."[m
[32m+[m[32m  exit 1[m
[32m+[m[32mfi[m
[32m+[m
[32m+[m[32mif ! docker compose version >/dev/null 2>&1; then[m
[32m+[m[32m  echo "Docker Compose plugin is not available."[m
[32m+[m[32m  exit 1[m
[32m+[m[32mfi[m
[32m+[m
[32m+[m[32mecho "Preflight checks passed."[m
[32m+[m[32mecho "No deployment or database changes have been made."[m
[32m+[m[32mecho "Review Compose configuration and test migrations before enabling deployment."[m
