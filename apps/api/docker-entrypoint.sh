#!/bin/sh
# Applies pending migrations, optionally seeds demo data, then starts the API.
set -e

node_modules/.bin/prisma migrate deploy

if [ "${SEED_ON_START:-false}" = "true" ]; then
  node dist/seed/run-seed.js
fi

exec node dist/main.js
