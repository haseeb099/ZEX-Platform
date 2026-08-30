# CRM ↔ ZEX-Platform contract tests

These tests prove the **integration boundary** between Twenty/ZEX-CRM and ZEX-Platform without calling live SaaS or production Twenty.

They are **not** a substitute for a later staging run against a pinned real ZEX-CRM/Twenty instance.

## How to run

```bash
# Requires Postgres + Redis (docker compose or CI services) and applied migrations
npx prisma migrate deploy
npm run test:contract
```

Related suites:

| Suite    | Command                 | Intent                                                                |
| -------- | ----------------------- | --------------------------------------------------------------------- |
| Unit     | `npm test`              | Isolated logic (crypto, scoring, mocked collaborators)                |
| E2E-lite | `npm run test:e2e`      | Lightweight HMAC payload contract only — **not** full CRM integration |
| Contract | `npm run test:contract` | Fake Twenty GraphQL + Prisma + webhook → queue → worker write-back    |

## What is covered today

1. **CRM read contract** — `TwentyClient.getPerson(tenantId, id)` issues HTTP GraphQL to the tenant’s stored `graphqlUrl` with the decrypted bearer token from `TwentyConnection` (not injected plaintext into the client).
2. **CRM write contract** — `TwentyClient.updatePerson(...)` hits the same tenant endpoint with expected mutation variables and interprets the response.
3. **Tenant isolation (client)** — two tenants with different workspace IDs, GraphQL ports/URLs, and API keys; Tenant A never uses Tenant B’s Authorization header or endpoint.
4. **Webhook → queue boundary** — signed Twenty-style webhook against the real Fastify controller path:
   - tenant-specific webhook secret validates
   - wrong secret → 401 fail-closed
   - valid event → `WebhookLog` + BullMQ `enrich-and-score-person` job
   - duplicate nonce → `{ duplicate: true }` with **no second WebhookLog and no second BullMQ job** (job-count assertion)
5. **Webhook → worker → CRM write-back** (`worker-writeback.contract-spec.ts`):

```text
signed Twenty webhook
→ WebhookLog
→ BullMQ enrich-and-score job
→ real EnrichAndScoreProcessor
→ controlled EnrichmentService + real ScoringService
→ unmocked TwentyClient
→ localhost fake Twenty GraphQL
→ ScoreHistory + AuditLog + WebhookLog success
```

Observed CRM operations (success path):

- `GetPerson`
- `UpdatePerson` (deterministic enrichment fields)
- `CreateNote`
- `CreateOpportunity` (score ≥ tenant threshold)

Also covered:

- **Worker tenant isolation** — Tenant A processing never hits Tenant B’s fake server/key (and the reverse).
- **Enrichment failure** — controlled enrichment throws BullMQ `UnrecoverableError` → job `failed`, `WebhookLog.status=failed`, no success audit, no CRM write mutations. Uses `UnrecoverableError` so CI does not wait through production’s 5× exponential backoff; production retry/backoff options on the webhook-enqueued job are unchanged when env overrides are unset.
- **CRM write failure** — fake Twenty fails `UpdatePerson` or `CreateOpportunity` → error propagates → BullMQ job fails → `WebhookLog` failed → **no** `AuditLog.success=true` → **no** `ScoreHistory` / synthetic `pending-twenty-*` opportunity ids → no further mutations after the failed write. Contract tests set `BULLMQ_ENRICH_ATTEMPTS=1` for terminal assertions only; production default remains 5 attempts / 2000ms exponential backoff.
- **Partial-success retry idempotency** — first attempt succeeds `UpdatePerson` + `CreateNote`, fails `CreateOpportunity`; retry skips committed writes and succeeds opportunity → exactly one note, two opportunity attempts (one fail + one success), checkpoints scoped per `webhookLogId`.
- **Separate webhook events** — a second webhook for the same person is not suppressed by prior checkpoints.

## CRM failure semantics (production)

- `GetPerson` failures **propagate** by default (BullMQ retries). Snapshot fallback requires explicit `ALLOW_TWENTY_SNAPSHOT_FALLBACK=true` (default `false`).
- `UpdatePerson` / `CreateNote` failures **propagate** (no warn-and-continue).
- When auto-opportunity is required, `CreateOpportunity` failures **propagate**. `opportunityCreated` is true only after Twenty returns a real opportunity id — never a synthetic `pending-twenty-*` id.
- `AuditLog` with `success: true` is written only after required CRM writes succeed.

### Partial-success retry idempotency (production)

`JobActionCheckpoint` records completed CRM writes per `(tenantId, webhookLogId, action)`. BullMQ retries skip already-checkpointed `UpdatePerson`, `CreateNote`, and `CreateOpportunity` for the same webhook event. See `docs/PLATFORM_SECURITY_HARDENING.md`.

## What is real

- Prisma / Postgres (`Tenant`, `TwentyConnection`, encrypted secrets, `WebhookLog`, `ScoreHistory`, `AuditLog`, `JobActionCheckpoint`)
- `CryptoService` encrypt/decrypt
- `TwentyConnectionService` resolution
- `TwentyClient` (unmocked) over real HTTP to localhost
- Nest webhook controller + signature + idempotency (Redis)
- BullMQ enqueue **and** real `EnrichAndScoreProcessor` worker consumption
- `ScoringService` / `ScoringEngine` with tenant rules from Postgres
- `AuditService`

## What is mocked / faked / overridden

- **Fake localhost Twenty GraphQL HTTP server** (`test/contract/fake-twenty-server.ts`) — models **pinned Twenty workspace schema** (`person(filter:)`, `updatePerson(id,data:)`, `createNote` + `createNoteTarget`, `createOpportunity(data:)`)
- **`EnrichmentService` Nest override** — deterministic enrichment payload (no Clearbit / Apollo / Hunter)
- No production Twenty and no internet SaaS credentials required

## What this does NOT yet prove

- Live GraphQL schema compatibility with a pinned ZEX-CRM/Twenty upstream version
- Real Twenty migrations / ZEX App integration
- Staging networking and auth configuration against a real pinned CRM instance
- Score history dedupe across worker retries (CRM writes are checkpointed)

Those remain follow-ups (staging against pinned ZEX-CRM recommended).

## CI

GitHub Actions runs `npx prisma migrate deploy` then `npm run test:contract` against workflow Postgres and Redis services.
