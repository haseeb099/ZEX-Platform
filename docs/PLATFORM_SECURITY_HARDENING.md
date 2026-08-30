# Platform security hardening (ZEX-31 gate)

Operational and security hardening applied before staging against pinned ZEX-CRM/Twenty.

**Live Twenty compatibility is not validated in this gate** — contract tests use a localhost fake GraphQL server only.

## CRM action idempotency

### Model

`JobActionCheckpoint` persists completed CRM write actions per:

- `tenantId`
- `webhookLogId` (one webhook processing event)
- `action` (`update_person`, `create_note`, `create_opportunity`)

Unique constraint: `(tenantId, webhookLogId, action)`.

### Retry semantics

On BullMQ retry after partial success:

1. `GetPerson` may run again (no checkpoint — read is safe to repeat).
2. `UpdatePerson` skipped if checkpoint `update_person` is `completed`.
3. `CreateNote` skipped if checkpoint `create_note` is `completed`.
4. `CreateOpportunity` retried if not checkpointed; on success stores `externalId`.

Checkpoints are written **only after confirmed Twenty response**. Failed actions do not checkpoint.

If a later action fails, the job still fails/retries. Already-checkpointed actions are not repeated for the same webhook event.

Different webhook events for the same person get independent checkpoint rows (scoped by `webhookLogId`).

### Known remaining risk

`ScoreHistory` may still be inserted on each retry attempt if enrichment/scoring re-runs before final success. CRM duplicate writes are guarded; score history dedupe is a follow-up if needed.

## Secret handling

- Tenant provisioning encrypts `apiKey` and `webhookSecret` at rest (AES-256-GCM).
- Admin API responses (`createTenant`, `getTenantSafe`) never return secrets.
- `redactSecrets()` helper redacts known key names before structured logging.
- Bearer tokens and provider API keys are in the redaction list.

## Master key requirements

- Env validation: 64 hex characters (`MASTER_KEY`).
- `CryptoService` additionally verifies decoded length is exactly 32 bytes at startup.
- Unit tests cover round-trip, random IV, tamper detection, and malformed ciphertext.

## Admin credential behavior

- `AdminApiKeyGuard`: missing or wrong Bearer token → `401 Unauthorized`.
- Comparison uses `timingSafeEqual` via `secureCompareStrings` (equal-length check).
- Error messages do not echo the provided or expected key.

## Tenant isolation

- `TwentyConnectionService.resolve()` scopes by `tenantId`; inactive/missing tenants throw.
- `JobActionCheckpoint` unique key includes `tenantId` — Tenant A checkpoints never suppress Tenant B.
- Contract tests prove worker write-back uses tenant-specific credentials and checkpoint scoping.

## Dependency review

See [`SECURITY_DEPENDENCY_REVIEW.md`](./SECURITY_DEPENDENCY_REVIEW.md) for triage results, actions taken, and deferred items.

## What remains for staging

1. Validate against **pinned ZEX-CRM/Twenty** (real GraphQL schema, auth, webhook payload shapes).
2. End-to-end smoke on staging infrastructure (Postgres, Redis, secrets management).
3. Operational runbooks (key rotation, connection verification, replay monitoring).
4. Optional: score history idempotency on worker retries.
