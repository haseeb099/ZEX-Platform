# Staging runbook — pinned ZEX-CRM/Twenty + ZEX-Platform

Operational steps for local/staging validation only. **Not for production.**

## Prerequisites

- Docker (Twenty + Platform Postgres/Redis)
- **Node.js `^24.5.0`** (ZEX-CRM enforces this in `yarn.config.cjs`; Node 22 fails post-install)
- Corepack + **Yarn 4.13.0** (`packageManager` in ZEX-CRM `package.json`)
- ZEX-CRM at pinned commit (`zex/twenty-upstream.json`)
- ZEX-Platform on `test/pinned-twenty-staging-validation` (PR #7)

### Windows notes (verified 2026-08-30)

1. Install Node 24 LTS, e.g. `winget install OpenJS.NodeJS.LTS`
2. Corepack may fail to write global shims (`EPERM` under `Program Files\nodejs`). Workaround: add a user-local shim directory to `PATH`:

```powershell
$shimDir = "$env:LOCALAPPDATA\zex-node-shims"
New-Item -ItemType Directory -Force -Path $shimDir | Out-Null
Set-Content "$shimDir\yarn.cmd" '@echo off`r`ncorepack yarn %*' -Encoding ASCII
$env:Path = "$shimDir;" + $env:Path
corepack prepare yarn@4.13.0 --activate
```

3. ZEX-CRM `.env` Postgres URL must use **host port `5433`** when using `docker-compose.dev.yml` (maps `5433:5432`).

## 1. Start Twenty infra

```bash
cd ZEX-CRM
docker compose -f packages/twenty-docker/docker-compose.dev.yml up -d
yarn install
```

## 2. Migrate + seed Twenty (first time / clean DB)

From `ZEX-CRM/packages/twenty-server` (with `.env` copied from `.env.example`, PG on `:5433`):

```bash
node dist/database/scripts/setup-db.js
node dist/command/command.js run-instance-commands --force --include-slow
node dist/command/command.js workspace:seed:dev
```

## 3. Start Twenty server

```bash
cd ZEX-CRM/packages/twenty-server
set NODE_ENV=development
node --enable-source-maps dist/main
```

Health: `http://localhost:3000/healthz`

GraphQL: `http://localhost:3000/graphql` (workspace data)  
Metadata: `http://localhost:3000/metadata` (auth, API keys)

## 4. Start Platform stack

```bash
cd ZEX-Platform
docker compose up -d
npx prisma migrate deploy
```

Platform `.env` must include:

```text
STAGING_DETERMINISTIC_ENRICHMENT=true
ALLOW_TWENTY_SNAPSHOT_FALLBACK=false
OTEL_ENABLED=false
```

Start API + worker:

```bash
npm run start:dev
```

Health: `http://localhost:3002/health`

## 5. Bootstrap staging credentials (local only)

Create API key + workspace binding (do not commit output):

- Sign in via metadata GraphQL (`getLoginTokenFromCredentials` → `getAuthTokensFromLoginToken`)
- `createApiKey` + `generateApiKeyToken`
- Write `STAGING_*` vars to `.env.staging.local` (gitignored)

Required vars — see `scripts/staging/staging-env.ts`.

## 6. Run staging smoke

```bash
# load .env.staging.local into shell, then:
npm run test:staging:twenty
node scripts/staging/verify-staging-evidence.js
```

## 7. Expected pass criteria

- GraphQL probe steps pass against real Twenty
- `WebhookLog` → `success`
- `JobActionCheckpoint` → at least `update_person`, `create_note`
- Person `jobTitle` → `VP Engineering` (deterministic enrichment)
- Wrong webhook secret → `401`, no new logs

## 8. Webhook delivery to localhost

Twenty may block private-IP webhook targets. Options:

1. Disable outbound safe mode (staging only), **or**
2. Tunnel Platform to a public URL, **or**
3. Use signed payload replay (network delivery remains unproven)

## 9. Cleanup

- Remove staging tenants/persons in Twenty + Platform DB
- `docker compose down` (both repos)
