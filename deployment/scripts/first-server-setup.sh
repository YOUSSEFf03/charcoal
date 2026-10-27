#!/usr/bin/env bash
set -Eeuo pipefail
# Run on Ubuntu after placing this pack's deployment directory into the repo.
ROOT=/opt/farah-charcoal
sudo mkdir -p "$ROOT"
sudo chown "$USER":"$USER" "$ROOT"
echo "Next: clone your repository into $ROOT/app, copy the deployment pack into $ROOT/app/deployment,"
echo "create $ROOT/.env.production and $ROOT/.deploy-config, then review deploy.sh before first run."
