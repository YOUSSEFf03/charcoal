#!/bin/sh
set -eu
cd /app
# Migrations are serialized by Compose's single backend replica.
npm exec --workspace=@charcoal/backend -- prisma migrate deploy --schema prisma/schema.prisma
exec node apps/backend/dist/src/main.js
