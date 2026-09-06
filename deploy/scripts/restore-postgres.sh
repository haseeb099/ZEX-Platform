#!/usr/bin/env bash
# Linux restore helper — disposable DB by default.
# Required: BACKUP_FILE, RESTORE_DATABASE_URL (or PG* pointing at disposable DB)
# Production restore requires ALLOW_PRODUCTION_RESTORE=true and CONFIRM_PHRASE=RESTORE_PRODUCTION_CONFIRM
set -euo pipefail

: "${BACKUP_FILE:?BACKUP_FILE required}"

if [[ "${ALLOW_PRODUCTION_RESTORE:-false}" == "true" ]]; then
  if [[ "${CONFIRM_PHRASE:-}" != "RESTORE_PRODUCTION_CONFIRM" ]]; then
    echo "Production restore requires CONFIRM_PHRASE=RESTORE_PRODUCTION_CONFIRM" >&2
    exit 1
  fi
  echo "WARNING: restoring into production-confirmed target"
else
  : "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL required for disposable restore}"
  # Export PG* from URL without printing password
  proto="$(echo "${RESTORE_DATABASE_URL}" | sed -E 's#^([^:]+)://.*#\1#')"
  if [[ "${proto}" != postgresql && "${proto}" != postgres ]]; then
    echo "RESTORE_DATABASE_URL must be postgres(ql)" >&2
    exit 1
  fi
  export PGUSER="$(node -e "const u=new URL(process.env.RESTORE_DATABASE_URL);process.stdout.write(decodeURIComponent(u.username))")"
  export PGPASSWORD="$(node -e "const u=new URL(process.env.RESTORE_DATABASE_URL);process.stdout.write(decodeURIComponent(u.password))")"
  export PGHOST="$(node -e "const u=new URL(process.env.RESTORE_DATABASE_URL);process.stdout.write(u.hostname)")"
  export PGPORT="$(node -e "const u=new URL(process.env.RESTORE_DATABASE_URL);process.stdout.write(u.port||'5432')")"
  export PGDATABASE="$(node -e "const u=new URL(process.env.RESTORE_DATABASE_URL);process.stdout.write(u.pathname.replace(/^\//,'').split('?')[0])")"
fi

: "${PGHOST:?}"
: "${PGUSER:?}"
: "${PGDATABASE:?}"

pg_restore --clean --if-exists --no-owner --no-acl -d "${PGDATABASE}" "${BACKUP_FILE}"
echo "OK restore into ${PGDATABASE}@${PGHOST}"
