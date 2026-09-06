#!/usr/bin/env bash
# Linux production helper: run prisma migrate deploy inside the immutable app image.
# Usage:
#   export ZEX_PLATFORM_IMAGE=registry/zex-platform:<sha>
#   export ZEX_PRODUCTION_ENV_FILE=/secure/path/.env.production
#   ./deploy/scripts/migrate.sh
set -euo pipefail

: "${ZEX_PLATFORM_IMAGE:?ZEX_PLATFORM_IMAGE must be set to an immutable image ref (never latest)}"

if [[ "${ZEX_PLATFORM_IMAGE}" == *:latest || "${ZEX_PLATFORM_IMAGE}" == latest ]]; then
  echo "Refusing floating tag :latest" >&2
  exit 1
fi

ENV_FILE="${ZEX_PRODUCTION_ENV_FILE:-.env.production}"
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Env file not found: ${ENV_FILE}" >&2
  exit 1
fi

echo "Running prisma migrate deploy via ${ZEX_PLATFORM_IMAGE%%:*}:<tag>"
docker run --rm --env-file "${ENV_FILE}" \
  -e NODE_ENV=production \
  "${ZEX_PLATFORM_IMAGE}" \
  npx prisma migrate deploy
