#!/usr/bin/env bash
# Linux production helper: pg_dump custom-format backup.
# Prefer PG* env or .pgpass — do not put passwords on the CLI.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "${BACKUP_DIR}"
ENV_NAME="${ZEX_BACKUP_ENV:-${NODE_ENV:-production}}"
SHA="${ZEX_RELEASE_SHA:-unknown}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${BACKUP_DIR}/zex-platform_${ENV_NAME}_${SHA}_${TS}.dump"

: "${PGHOST:?PGHOST required}"
: "${PGUSER:?PGUSER required}"
: "${PGDATABASE:?PGDATABASE required}"

pg_dump -Fc -f "${OUT}"
BYTES="$(wc -c < "${OUT}" | tr -d ' ')"
if [[ "${BYTES}" -lt 64 ]]; then
  echo "Backup too small (${BYTES} bytes)" >&2
  exit 1
fi

cat > "${OUT}.json" <<EOF
{"createdAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","environment":"${ENV_NAME}","releaseSha":"${SHA}","format":"pg_dump-Fc","fileName":"$(basename "${OUT}")","bytes":${BYTES},"database":"${PGDATABASE}","host":"${PGHOST}"}
EOF

echo "OK backup $(basename "${OUT}") (${BYTES} bytes)"
