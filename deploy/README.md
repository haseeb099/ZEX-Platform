# Deploy artifacts (ZEX-27)

Provider-agnostic production packaging for ZEX-Platform.

| File | Purpose |
|------|---------|
| `docker-compose.production.yml` | API + migrate; optional self-hosted Postgres/Redis profile |
| `.env.production.example` | Secret/env contract (placeholders only) |
| `scripts/migrate.sh` | One-shot `prisma migrate deploy` via immutable image |
| `scripts/backup-postgres.sh` | Linux `pg_dump -Fc` |
| `scripts/restore-postgres.sh` | Linux restore (disposable by default) |

Full procedure: [`docs/PRODUCTION_RUNBOOK.md`](../docs/PRODUCTION_RUNBOOK.md).

Portable Node tools: `scripts/ops/` (`npm run ops:validate-image|backup|restore|smoke`).
