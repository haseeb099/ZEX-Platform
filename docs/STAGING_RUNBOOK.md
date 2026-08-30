# Staging runbook — pinned ZEX-CRM/Twenty + ZEX-Platform

Operational steps for local/staging validation only. **Not for production.**

## Prerequisites

- Docker (for ZEX-CRM Postgres/Redis and optionally Platform Postgres/Redis)
- Node.js 24+ recommended for ZEX-CRM source runs (Node 22 may work with warnings)
- Yarn 4 (ZEX-CRM)
- ZEX-CRM repo at pinned commit (see `zex/twenty-upstream.json`)
- ZEX-Platform repo on staging validation branch

## 1. Start pinned ZEX-CRM/Twenty

From `ZEX-CRM` repo root:

```bash
bash packages/twenty-utils/setup-dev-env.sh
npx nx database:reset twenty-server   # first time / clean slate
yarn start                            # server :3000, front, worker
```

Or Docker infra only:

```bash
docker compose -f packages/twenty-docker/docker-compose.dev.yml up -d
# then run twenty-server + worker from source
```

Record (no secrets in notes):

- GraphQL: `http://localhost:3000/graphql`
- REST: `http://localhost:3000/rest`
- Workspace id (from Twenty UI / metadata)
- API key (metadata API → `createApiKey` + `generateApiKeyToken`)

### Webhook delivery to localhost

Twenty blocks private-IP webhook targets when `OUTBOUND_HTTP_SAFE_MODE_ENABLED=true`. For local Platform webhook delivery:

1. Disable safe mode via admin config (`OUTBOUND_HTTP_SAFE_MODE_ENABLED=false`), **or**
2. Expose Platform via a non-private URL (tunnel), **or**
3. Fall back to manual signed webhook using observed payload shape (see staging smoke script).

## 2. Start Platform Postgres + Redis

From `ZEX-Platform`:

```bash
docker compose up -d
npx prisma migrate deploy
```

Default local ports: Postgres `5434`, Redis `6380`, Platform `3002` (per `.env`).

## 3. Start ZEX-Platform API + worker

```bash
npm run build
npm run start:prod
# Ensure BullMQ worker processes enrich-and-score jobs (same process in Nest default module graph)
```

Set for staging runs:

```text
STAGING_DETERMINISTIC_ENRICHMENT=true
ALLOW_TWENTY_SNAPSHOT_FALLBACK=false
```

## 4. Configure staging env (no secrets in git)

Export:

```text
STAGING_TWENTY_BASE_URL=http://localhost:3000
STAGING_TWENTY_GRAPHQL_URL=http://localhost:3000/graphql
STAGING_TWENTY_REST_URL=http://localhost:3000/rest
STAGING_TWENTY_WORKSPACE_ID=<workspace-uuid>
STAGING_TWENTY_API_KEY=<bearer-token>
STAGING_TWENTY_WEBHOOK_SECRET=<webhook-secret>
STAGING_PLATFORM_BASE_URL=http://localhost:3002
STAGING_PLATFORM_ADMIN_API_KEY=<admin-key>
```

Optional:

- `STAGING_TWENTY_PERSON_ID` — reuse existing person instead of creating
- `STAGING_USE_REAL_WEBHOOK_DELIVERY=true` — when Twenty webhook is configured to Platform URL

## 5. Configure Twenty webhook (metadata API)

Create webhook targeting:

```text
<STAGING_PLATFORM_BASE_URL>/webhooks/twenty/<tenantId>
```

Operations: `person.created` (and `person.updated` if testing updates).

Secret must match tenant `webhookSecret` used at provisioning.

## 6. Run staging smoke

```bash
npm run test:staging:twenty
```

## 7. Inspect Platform state

- `WebhookLog` → `success`
- `JobActionCheckpoint` rows for `update_person`, `create_note`, `create_opportunity`
- `AuditLog.success=true`
- `ScoreHistory` row

## 8. Verify CRM state

In Twenty UI or GraphQL:

- Person `jobTitle` updated to enrichment result (`VP Engineering` with deterministic staging enrichment)
- One automation note linked to person
- Opportunity when threshold met

## 9. Cleanup

- Delete staging person/opportunity/notes in Twenty
- Delete staging tenant via DB cascade or admin tooling
- Re-enable `OUTBOUND_HTTP_SAFE_MODE_ENABLED` if disabled

## 10. Rollback

- `docker compose down` (Platform)
- `docker compose -f packages/twenty-docker/docker-compose.dev.yml down` (Twenty infra)
- Restore env flags to defaults
