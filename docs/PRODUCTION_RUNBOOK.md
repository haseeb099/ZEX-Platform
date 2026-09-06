# ZEX-Platform production runbook (ZEX-27)

Provider-agnostic production deployment contract for **ZEX-Platform**.

This document answers: what immutable image is deployed, required secrets, how migrations run, how the API becomes healthy, how Postgres backups/restores work, how Redis is treated, how rollback works, required smoke checks, and what is unsafe in production.

**Not covered here:** choosing AWS/GCP/Railway/Render/Fly/Kubernetes, creating paid cloud accounts, or changing product behavior.

Related: `docs/STAGING_RUNBOOK.md` (local/staging only — **not** production-safe). Staging and production **must** use separate secrets, databases, and Redis instances/namespaces.

## Acceptance (ZEX-27)

> Pinned versions, staging and production healthy, backups tested, smoke checklist green.

This PR prepares deployable artifacts. Actual host provisioning is a later execution step after review.

---

## 1. Immutable application image

### Build

```bash
git rev-parse HEAD   # record SHA
export ZEX_RELEASE_SHA=$(git rev-parse HEAD)
docker build -t "zex-platform:${ZEX_RELEASE_SHA}" -f Dockerfile .
```

### Tag / pin rules

| Rule | Requirement |
|------|-------------|
| Tag | Commit SHA and/or release id only |
| Forbidden | `:latest`, untagged floating refs |
| Deploy | `ZEX_PLATFORM_IMAGE` **required** — compose fails if unset |
| Validation | `npm run ops:validate-image` |

Example:

```text
ghcr.io/example/zex-platform:72e88e95c86a3b5f004d27cf662bbb79146cb87c
```

Runtime image:

- Node production dependencies only (+ `prisma` CLI for one-shot `migrate deploy`; Nest emit uses relative requires so no `tsconfig-paths` at runtime)
- Prisma client generated at build time
- No `.env`, no test credentials, non-root user `zex`
- Default CMD runs the API; migrate is a one-shot command override

---

## 2. Environment / secrets contract

Template: `deploy/.env.production.example`  
Host file suggestion: `.env.production` (**gitignored**, never baked into the image).

Required (see also Joi boot schema in `src/config/env.schema.ts`):

| Variable | Notes |
|----------|--------|
| `NODE_ENV=production` | |
| `PORT` | Default 3000 in container |
| `DATABASE_URL` | Prefer TLS (`sslmode=require` etc.) |
| `REDIS_URL` | Dedicated prod instance/DB index |
| `MASTER_KEY` | 64 hex chars; **unique per environment** |
| `JWT_SECRET` | ≥32 chars; unique per environment |
| `ADMIN_API_KEY` | ≥32 chars; CRM server proxy only — never browsers |
| `SDR_REPLY_WEBHOOK_SECRET` | ≥16 chars |
| `ALLOW_TWENTY_SNAPSHOT_FALLBACK=false` | Do not relax in production |

### `MASTER_KEY` rotation

Tenant Twenty API keys / webhook secrets are encrypted at rest with `MASTER_KEY`. Rotating the key **without** a re-encryption migration makes existing ciphertext unreadable. Treat rotation as an explicit engineering change, not a casual redeploy.

Optional: enrichment keys, Sentry/OTEL, smoke vars (`SMOKE_*`).

---

## 3. Migration safety

**Only** `prisma migrate deploy` in production. **Never** `prisma migrate dev`.

Preferred sequence:

```text
backup
→ one-shot migrate job (single replica)
→ app deploy / roll forward
→ /health
→ smoke
```

Helper:

```bash
export ZEX_PLATFORM_IMAGE=...
export ZEX_PRODUCTION_ENV_FILE=/secure/.env.production
./deploy/scripts/migrate.sh
# or:
docker compose -f deploy/docker-compose.production.yml --profile migrate run --rm migrate
```

Rules:

- One migrate job at a time — do not race multiple migrate containers
- Migrate failure **blocks** promotion
- Schema rollback is **not** automatic; migrations are forward-only unless separately engineered
- App replicas must not run `migrate dev`

---

## 4. Production deployment definition

File: `deploy/docker-compose.production.yml`

- Requires `ZEX_PLATFORM_IMAGE` (fails closed if absent / if you pass `:latest` through `ops:validate-image`)
- `api` service + optional `migrate` profile
- Optional `selfhosted` profile for lab Postgres/Redis — **not** required when using managed URLs
- Publish port via `ZEX_PUBLISH_PORT` (default 3000)

External/managed Postgres + Redis are the preferred production topology (set `DATABASE_URL` / `REDIS_URL` only).

---

## 5. Postgres backup

### Requirements

- `pg_dump -Fc` (custom format)
- Filename includes environment + release SHA + UTC timestamp
- Written under `BACKUP_DIR` (default `./backups`, **gitignored**)
- Credentials never printed
- Non-zero exit on failure; artifact size validated

### Node (cross-platform ops host)

```bash
export DATABASE_URL=...
export ZEX_RELEASE_SHA=...
export ZEX_BACKUP_ENV=production
# On Windows local parity without pg_dump installed:
export BACKUP_USE_DOCKER=1
export BACKUP_DOCKER_CONTAINER=twenty-automation-db
npm run ops:backup
```

### Linux production host

```bash
export PGHOST=... PGUSER=... PGDATABASE=...   # PGPASSWORD via env/.pgpass
export ZEX_RELEASE_SHA=...
./deploy/scripts/backup-postgres.sh
```

**Always backup before migrations.**

Retention (guidance): keep daily backups ≥7 days, weekly ≥4 weeks, and pre-migrate backups until the next successful migrate + smoke. Adjust to your RPO.

---

## 6. Restore

### Safety

- Default target: **disposable** DB via `RESTORE_DATABASE_URL`
- Production restore requires **both**:
  - `ALLOW_PRODUCTION_RESTORE=true`
  - `CONFIRM_PHRASE=RESTORE_PRODUCTION_CONFIRM`
- Refuses when disposable URL equals production URL without that confirmation

```bash
export BACKUP_FILE=./backups/zex-platform_....dump
export RESTORE_DATABASE_URL=postgresql://.../zex_platform_restore_test
npm run ops:restore
```

Restore is **disaster recovery**, not casual application rollback.

### Restore test checklist (required before calling backup “tested”)

1. Seed known fixture rows in a disposable DB  
2. `ops:backup`  
3. Restore into a **clean** disposable DB  
4. `prisma migrate status` (schema present / consistent)  
5. Validate representative counts/records  
6. Keep evidence (backup `.json` metadata + validation notes)

---

## 7. Redis policy

Redis is **queue / cache / runtime** infrastructure (BullMQ), **not** the canonical business database.

| Topic | Policy |
|-------|--------|
| Canonical data | Postgres (Tenant, AuditLog, agents, SDR, etc.) |
| Persistence | Prefer AOF (`appendonly yes`) for self-hosted examples |
| Memory | `maxmemory-policy noeviction` so jobs are not silently dropped |
| Restart | In-flight jobs may retry per BullMQ settings; durable domain state is in Postgres |
| Backup | Postgres backup remains the primary durable backup — do **not** claim Redis restore guarantees the product does not implement |

Staging and production must not share Redis.

---

## 8. Health / readiness

`GET /health`

Returns:

```json
{
  "status": "ok",
  "timestamp": "...",
  "release": "<ZEX_RELEASE_SHA or null>",
  "checks": { "database": "ok", "redis": "ok" }
}
```

- Ready only when `status=ok` and both checks `ok`
- No secrets in payload
- Orchestrators should wait for healthy before sending traffic

---

## 9. Smoke

```bash
export SMOKE_BASE_URL=http://127.0.0.1:3000
export RUN_MIGRATE_STATUS=1
export DATABASE_URL=...
# optional read-only admin checks:
export SMOKE_ADMIN_API_KEY=...
export SMOKE_WORKSPACE_ID=...
export SMOKE_TENANT_ID=...
npm run ops:smoke
```

Checks (read-only by default):

- `/health` (+ secret scan)
- optional `prisma migrate status`
- optional workspace→tenant resolution
- optional Agent Control overview + Action Feed

**Does not** mutate customer data. Mutation tests require separate disposable fixtures (out of scope for default smoke).

---

## 10. Rollback

| Layer | Action |
|-------|--------|
| Application | Redeploy prior **immutable** image SHA (`ZEX_PLATFORM_IMAGE=...:previous_sha`) |
| Database schema | Forward-only; do not auto-rollback migrations |
| Data disaster | Restore Postgres backup into a planned DR procedure (confirmed) |
| Secrets | Rotating `MASTER_KEY` / API keys needs an explicit plan; rolling back app image does not un-rotate keys |

If a migration already applied is incompatible with an older app, roll **forward** with a fix migration or restore from pre-migrate backup into a recovery environment first.

---

## 11. Staging → production promotion

1. Staging green on the **same** immutable SHA  
2. Production secrets present (separate from staging)  
3. `ops:validate-image`  
4. Postgres backup  
5. `migrate deploy` (one-shot)  
6. Deploy API image  
7. `/health` green with expected `release`  
8. `ops:smoke`  
9. Monitor errors/queues  

---

## 12. What is not safe in production

- Deploying `:latest` or untagged images  
- Sharing DB/Redis/secrets with staging  
- `prisma migrate dev`  
- Racing migrate across replicas  
- Browser-held `ADMIN_API_KEY`  
- `ALLOW_TWENTY_SNAPSHOT_FALLBACK=true`  
- Baking `.env` into images  
- Treating Redis dump as sufficient DR  
- Unconfirmed restores into production  
- Casual DB schema “rollback”

---

## 13. Incident basics

1. Check `/health` and recent deploys (`ZEX_RELEASE_SHA`)  
2. Check Postgres connectivity and migration status  
3. Check Redis / BullMQ backlog  
4. Prefer roll forward; use backup restore only under DR  
5. Rotate compromised secrets with encryption implications in mind  

---

## File map

| Path | Purpose |
|------|---------|
| `Dockerfile` | Production multi-stage image |
| `deploy/docker-compose.production.yml` | Provider-neutral compose |
| `deploy/.env.production.example` | Env contract (placeholders) |
| `deploy/scripts/*.sh` | Linux migrate/backup/restore |
| `scripts/ops/*` | Portable Node ops tools |
| `docs/PRODUCTION_RUNBOOK.md` | This document |
