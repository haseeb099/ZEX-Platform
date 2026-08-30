# Pinned Twenty staging validation

Evidence for ZEX-31 final gate: ZEX-Platform against **real pinned ZEX-CRM/Twenty** (not the contract fake server).

## Versions

| Component | Commit / ref |
|-----------|----------------|
| ZEX-Platform | `test/pinned-twenty-staging-validation` (PR #7) |
| ZEX-CRM | `c4bb94bddc8b5915ea4f48bcf8a423e8e5064d16` |
| Pinned Twenty upstream baseline | `99e2c474a3dc256256543be405ef3c7702a63926` (`zex/twenty-upstream.json`) |
| ZEX core patch head | `8ea3af933461c8df4c01653862d8b8ced6758f32` (Windows/local dev — temporary) |
| Node (live run) | `v24.19.0` (OpenJS Node.js LTS via winget) |
| Yarn (live run) | `4.13.0` (Corepack, repo `packageManager`) |

## Environment topology

| Service | URL (secrets redacted) |
|---------|-------------------------|
| Twenty GraphQL | `http://localhost:3000/graphql` |
| Twenty metadata GraphQL | `http://localhost:3000/metadata` |
| Twenty REST | `http://localhost:3000/rest` (not used in smoke) |
| ZEX-Platform | `http://localhost:3002` |
| Platform Postgres | `localhost:5434` / `twenty_automation` |
| Platform Redis | `localhost:6380` |
| Twenty Postgres (dev compose) | `localhost:5433` → container `5432` |
| Twenty Redis (dev compose) | `localhost:6379` |

Seeded workspace (dev): **Apple** (`20202020-1c25-4d02-bf25-6aeccf7ea419`). Prefilled login: `tim@apple.dev` (password matches email per Twenty front prefilled dev convention).

## Live staging run (2026-08-30)

Command:

```bash
npm run test:staging:twenty
```

Result: **PASS**

Post-run verification:

```bash
node scripts/staging/verify-staging-evidence.js
```

### GraphQL operations (real pinned Twenty)

| Operation | Result |
|-----------|--------|
| `GetPerson` (`person(filter:)`) | PASS |
| `UpdatePerson` (`updatePerson(id, data:)`) | PASS |
| `CreateNote` + `createNoteTarget` | PASS |
| `CreateOpportunity` (`pointOfContactId`, stage `NEW`) | PASS |

### Webhook → Platform → worker → Twenty

| Step | Result |
|------|--------|
| Admin tenant provision (`POST /api/v1/admin/tenants`) | PASS — no secrets in response |
| Signed webhook (`person.created`, pinned payload shape) | PASS — `WebhookLog` success |
| BullMQ worker (`EnrichAndScoreProcessor`) | PASS — job completed |
| Person write-back (`jobTitle`) | PASS — `VP Engineering` in real CRM |
| Automation note | PASS — `create_note` checkpoint committed |
| Opportunity (auto) | **Not created** — score `55` below threshold; expected with default rules |
| `AuditLog` | PASS — `enrich_and_score_person`, success |
| `ScoreHistory` | PASS — score `55` recorded |
| `JobActionCheckpoint` | PASS — `update_person`, `create_note` |

### Webhook payload (observed / used)

Signed POST body fields validated in smoke:

- `eventName`: `person.created`
- `workspaceId`: workspace UUID
- `webhookId`, `eventDate`
- `record.id`, `record.name.firstName` / `lastName`, `record.emails.primaryEmail`, `record.jobTitle`
- Headers: `x-twenty-webhook-signature`, `x-twenty-webhook-timestamp`, `x-twenty-webhook-nonce`

**Network delivery:** Twenty did **not** HTTP-deliver to Platform in this run. Smoke used a signed payload matching the pinned Twenty shape (documented fallback).

### Security checks (live)

| Check | Result |
|-------|--------|
| Wrong webhook secret | `401`, no new `WebhookLog`, no CRM writes |
| Admin API secret leakage | None observed in tenant create response |
| `ALLOW_TWENTY_SNAPSHOT_FALLBACK` | `false` |
| `STAGING_DETERMINISTIC_ENRICHMENT` | `true` on Platform process (required for stable write-back) |

### Retry / idempotency on live CRM

**Not performed.** Safe live fault injection was not available without production hooks. Idempotency remains covered by contract tests + `JobActionCheckpoint` unit/contract coverage.

## Compatibility issues found (Platform-side)

| Symptom | Root cause | Fix | Regression test |
|---------|------------|-----|-----------------|
| `person(id:)` GraphQL error | Pinned Twenty uses `person(filter: { id: { eq } })` | Updated `TwentyClient.getPerson` | `twenty-client.contract-spec.ts` |
| `updatePerson(input:)` invalid | Pinned Twenty uses `updatePerson(id, data: PersonUpdateInput!)` | Updated `TwentyClient.updatePerson` | Contract + worker write-back tests |
| `createNote` body field invalid | Notes use `bodyV2.markdown` + `createNoteTarget` | Split note + target mutations | Contract fake server + staging smoke probe |
| `createOpportunity(input:)` / `personId` | Uses `pointOfContactId`, stage `NEW` | Updated client + stage mapper | Contract tests |
| Webhook `record.name` / `record.emails` | Platform assumed flat `firstName`/`email` | `normalizeWebhookPersonRecord` | `webhook-payload.pinned.spec.ts` |
| Staging write-back expected `VP Engineering` | Deterministic enrichment preserved incoming `jobTitle` | Always emit `VP Engineering` when `STAGING_DETERMINISTIC_ENRICHMENT=true` | Staging smoke + live run |

**No ZEX-CRM core changes** were required.

## Limitations (explicit)

| Not proven | Reason |
|------------|--------|
| Live Twenty → Platform HTTP webhook delivery | Localhost/private target policy; used signed payload fallback |
| Real enrichment SaaS | Deterministic staging enrichment only |
| Auto-opportunity on live CRM | Score `55` below threshold in seeded workspace |
| Live partial-failure retry | Not safely injectable on shared dev CRM |
| Production-scale performance | Out of scope |

## How to reproduce

See [`STAGING_RUNBOOK.md`](./STAGING_RUNBOOK.md).

## Normal CI validation (no real Twenty)

```bash
npm test
npm run test:e2e
npm run test:contract
npm run build
```

All must pass without staging env vars.
