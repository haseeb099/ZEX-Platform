# Pinned Twenty staging validation

Evidence for ZEX-31 final gate: ZEX-Platform against **real pinned ZEX-CRM/Twenty** (not the contract fake server).

## Versions

| Component | Commit / ref |
|-----------|----------------|
| ZEX-Platform | `test/pinned-twenty-staging-validation` branch (see PR) |
| ZEX-CRM | `c4bb94bddc8b5915ea4f48bcf8a423e8e5064d16` |
| Pinned Twenty upstream baseline | `99e2c474a3dc256256543be405ef3c7702a63926` (`zex/twenty-upstream.json`) |
| ZEX core patch head | `8ea3af933461c8df4c01653862d8b8ced6758f32` (Windows/local dev — temporary) |

## Environment topology

| Service | URL (secrets redacted) |
|---------|-------------------------|
| Twenty GraphQL | `http://localhost:3000/graphql` |
| Twenty REST | `http://localhost:3000/rest` |
| ZEX-Platform | `http://localhost:3002` |
| Platform Postgres | `localhost:5434` / `twenty_automation` |
| Platform Redis | `localhost:6380` |
| Twenty Postgres (dev compose) | `localhost:5433` |
| Twenty Redis (dev compose) | `localhost:6379` |

## Compatibility issues found (Platform-side)

| Symptom | Root cause | Fix | Regression test |
|---------|------------|-----|-----------------|
| `person(id:)` GraphQL error | Pinned Twenty uses `person(filter: { id: { eq } })` | Updated `TwentyClient.getPerson` | `twenty-client.contract-spec.ts`, mapper unit tests |
| `updatePerson(input:)` invalid | Pinned Twenty uses `updatePerson(id, data: PersonUpdateInput!)` | Updated `TwentyClient.updatePerson` | Contract + worker write-back tests |
| `createNote` body field invalid | Notes use `bodyV2.markdown` + `createNoteTarget` for person link | Split note + target mutations | Contract fake server + staging smoke probe |
| `createOpportunity(input:)` / `personId` | Uses `data: OpportunityCreateInput` + `pointOfContactId`; stage `NEW` not `prospect` | Updated client + stage mapper | Contract tests |
| Webhook `record.name` / `record.emails` | Platform assumed flat `firstName`/`email` | `normalizeWebhookPersonRecord` in webhook controller | `webhook-payload.pinned.spec.ts` |
| `location` / company name on Person | Not standard pinned Person fields | Worker passes `companyId` only; ignores `location` | Worker contract assertions |

**No ZEX-CRM core changes** were required.

## Real flows validated

### GraphQL (direct against pinned Twenty)

When Twenty server is running with valid API key:

- `person(filter:)` read
- `updatePerson(id, data:)` write
- `createNote(data: { title, bodyV2 })` + `createNoteTarget`
- `createOpportunity(data: { pointOfContactId, stage })`

Validated by `npm run test:staging:twenty` probe step and/or manual GraphQL.

### Webhook → Platform → worker → Twenty

Staging smoke (`scripts/staging/pinned-twenty-smoke.ts`):

1. Provisions tenant via `POST /api/v1/admin/tenants` (no secrets in response)
2. Submits **signed** webhook body matching observed Twenty shape (`eventName`, `record`, `webhookId`, `eventDate`)
3. Waits for `WebhookLog` success, checkpoints, audit
4. Verifies Person `jobTitle` in real Twenty via GraphQL

### Limitations (explicit)

| Not proven in this environment | Reason |
|----------------------------------|--------|
| Live Twenty → Platform HTTP webhook delivery | SSRF safe mode blocks `127.0.0.1` targets unless disabled; smoke uses signed payload fallback |
| Real enrichment SaaS | `STAGING_DETERMINISTIC_ENRICHMENT=true` for controlled staging |
| Partial-failure retry on real CRM | Covered by contract tests + `JobActionCheckpoint`; not re-run against live CRM in this gate |
| Production-scale performance | Out of scope |

## Security observations

- Admin tenant API does not return API key / webhook secret (asserted in smoke script)
- Logger redaction remains enabled (`redactSecrets`)
- `ALLOW_TWENTY_SNAPSHOT_FALLBACK` remains default `false`
- Staging should stay behind local/trusted network (Fastify advisories documented in `SECURITY_DEPENDENCY_REVIEW.md`)

## How to reproduce

See [`STAGING_RUNBOOK.md`](./STAGING_RUNBOOK.md).

```bash
npm run test:staging:twenty
```

## Normal CI validation (no real Twenty)

```bash
npm test
npm run test:e2e
npm run test:contract
npm run build
```

All must pass without staging env vars.

## Staging remains next for production promotion

- Pin staging infrastructure config (secrets manager, non-local URLs)
- Prove real Twenty webhook HTTP delivery with safe mode policy
- Multi-tenant load/soak on pinned CRM version
