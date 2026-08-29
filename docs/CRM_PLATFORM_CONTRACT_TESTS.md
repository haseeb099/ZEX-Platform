# CRM ↔ ZEX-Platform contract tests

These tests prove the **integration boundary** between Twenty/ZEX-CRM and ZEX-Platform without calling live SaaS or production Twenty.

They are **not** a substitute for a later staging run against a pinned real ZEX-CRM/Twenty instance.

## How to run

```bash
# Requires Postgres + Redis (docker compose or CI services) and applied migrations
npx prisma migrate deploy
npm run test:contract -- --runInBand
```

Related suites:

| Suite | Command | Intent |
|-------|---------|--------|
| Unit | `npm test` | Isolated logic (crypto, scoring, mocked collaborators) |
| E2E-lite | `npm run test:e2e` | Lightweight HMAC payload contract only — **not** full CRM integration |
| Contract | `npm run test:contract` | Local fake Twenty GraphQL + Prisma + webhook → queue |

## What is covered today

1. **CRM read contract** — `TwentyClient.getPerson(tenantId, id)` issues HTTP GraphQL to the tenant’s stored `graphqlUrl` with the decrypted bearer token from `TwentyConnection` (not injected plaintext into the client).
2. **CRM write contract** — `TwentyClient.updatePerson(...)` hits the same tenant endpoint with expected mutation variables and interprets the response.
3. **Tenant isolation** — two tenants with different workspace IDs, GraphQL ports/URLs, and API keys; Tenant A never uses Tenant B’s Authorization header or endpoint.
4. **Webhook → queue boundary** — signed Twenty-style webhook against the real Fastify controller path:
   - tenant-specific webhook secret validates
   - wrong secret → 401 fail-closed
   - valid event → `WebhookLog` + BullMQ `enrich-and-score-person` job
   - duplicate nonce → `{ duplicate: true }` without a second log/job

## What is real

- Prisma / Postgres (`Tenant`, `TwentyConnection`, encrypted secrets)
- `CryptoService` encrypt/decrypt
- `TwentyConnectionService` resolution
- `TwentyClient` (unmocked) over real HTTP to localhost
- Nest webhook controller + signature + idempotency (Redis)
- BullMQ enqueue

## What is mocked / faked

- **Fake localhost Twenty GraphQL HTTP server** (`test/contract/fake-twenty-server.ts`) — deterministic Twenty-shaped responses; captures Authorization and operation payloads
- No Clearbit / Apollo / Hunter / production Twenty
- No internet access required

## What this does NOT yet prove

- Full worker pipeline: webhook → enrich/score processor → CRM write-back mutation observed end-to-end on the fake server
- Live schema compatibility with a pinned ZEX-CRM/Twenty version
- Multi-region / self-hosted auth edge cases beyond bearer API keys
- Admin tenant provisioning HTTP API E2E

Those remain follow-ups (staging against pinned ZEX-CRM recommended).

## CI

GitHub Actions runs `npm run test:contract -- --runInBand` after `prisma migrate deploy` against the workflow Postgres and Redis services.
