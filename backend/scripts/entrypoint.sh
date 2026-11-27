#!/bin/sh
# Container entrypoint: apply pending DB migrations, then run the command.
#   no arguments  -> start the API            (normal service)
#   with arguments -> run that instead         (one-off tasks, e.g. `node dist-tools/seed.js`)
# Migrations are idempotent and Prisma takes an advisory lock, so several tasks starting together is safe.
set -e
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "Applying database migrations..."
  npx prisma migrate deploy
fi
if [ "$#" -gt 0 ]; then
  exec "$@"
fi
exec node dist/main.js
