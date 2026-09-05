# AI SDR v1 (ZEX-36)

Approval-first outbound outreach for approved prospects with completed Research Agent packages.

## Core safety rule

**No outbound message may be sent without explicit human approval of that exact draft version/content hash.**

- Research approval ≠ send approval
- Prospect approval ≠ send approval
- High Why-Now score ≠ send approval
- Approval of draft v1 does **not** authorize draft v2

## Architecture

```
Company Brain → Discovery → Why-Now → approve prospect → Research
→ create SDR sequence → generate draft → approve exact draft → send
→ reply stops automation → optional reply/meeting drafts (new approvals)
→ CRM note sync (separate from send)
```

Module: `src/ai-sdr/`

Queues: `ai-sdr-send`, `ai-sdr-crm-sync`

## Models

- `SdrSequence` — campaign/sequence state
- `SdrDraft` — versioned drafts with `contentHash`
- `SdrApproval` — binds `draftId` + `draftVersion` + `contentHash`
- `SdrMessage` — durable send attempts with `idempotencyKey`
- `SdrReply` — inbound replies (`providerEventId` unique)
- `SdrMeetingBooking` — deterministic booking workflow

## State machine (sequence)

`DRAFTING` → `AWAITING_APPROVAL` → `APPROVED` → `ACTIVE` → `REPLIED` / `COMPLETED` / `CANCELLED` / `FAILED` / `PAUSED`

Illegal transitions fail closed (e.g. send while `REPLIED`/`CANCELLED`).

## Exact-draft approval

Approval stores `contentHash` + `version`. Send re-checks:

1. sequence not stopped
2. draft not superseded
3. active approval for this draft id
4. approval hash/version match live draft
5. live content hash still matches
6. explicit `targetEmail` present
7. candidate still `APPROVED`/`CREATED`

Worker reloads DB state before send (never trusts enqueue-only snapshot).

## Superseded drafts

Creating a new draft of the same purpose marks prior DRAFT/AWAITING/APPROVED drafts `SUPERSEDED` and revokes their approvals.

## Rejected drafts

`POST .../sdr/drafts/:draftId/reject` sets durable `REJECTED` (distinct from supersede/revoke). Rejected drafts cannot be approved or sent. Audited as `sdr_draft_rejected`. A later regenerated draft may still be created.

## Recipient safety

`targetEmail` must be supplied explicitly when creating the sequence.

Never synthesize emails from names/domains. Named research people are not email addresses. Without `targetEmail`, draft may exist but send is blocked.

## Draft grounding

Deterministic template generator (`draft-generator.ts`) uses Research Agent:

- `personalizationFacts`
- `doNotClaim`
- `whyNow`
- finding IDs
- optional named person

Unsupported phrases are rejected. Each distinct outbound (outreach, follow-up, reply, meeting) needs its own approval.

## Providers

- `OutboundMessageProvider` — `DeterministicOutboundProvider` (no real email; in-process idempotency by key)
- `MeetingProvider` — deterministic booking link + confirm

Env: `AI_SDR_DETERMINISTIC=true` (also preferred in `NODE_ENV=test`).

## Send idempotency

Key: `send:{tenantId}:{draftId}:{contentHash}` unique per tenant.

Retry returns existing SENT message. Provider also memoizes by idempotency key.

Crash-after-provider-success: deterministic provider returns same id on retry; DB unique key prevents duplicate message rows.

## Reply handling

Signed webhook: `POST /api/v1/webhooks/outbound/reply`

- HMAC over `${timestamp}:${rawBody}`
- Headers: `x-zex-sdr-signature`, `x-zex-sdr-timestamp`
- Secret: `SDR_REPLY_WEBHOOK_SECRET`
- Fail closed on bad signature / skew
- **Requires `providerMessageId`** (never trusts `sequenceId` alone on the public webhook)
- Idempotent on `providerEventId`

### Reply correlation (fail closed)

1. Resolve outbound message by `tenantId + providerMessageId`. Unknown → 404, no mutation.
2. Canonical sequence is always `message.sequenceId`.
3. If the payload also includes `sequenceId`, it **must** equal `message.sequenceId`. Mismatch → 400, no reply persisted, no sequence change, no CRM note.
4. Cross-tenant `providerMessageId` → 404 (tenant-scoped lookup).

Admin path `POST .../sdr/sequences/:sequenceId/replies` (Admin API key) may ingest by trusted path `sequenceId` for deterministic tests. If `providerMessageId` is also supplied there, the same mismatch rule applies.

Any genuine reply → sequence `REPLIED` (or `CANCELLED` for NEGATIVE/UNSUBSCRIBE).

Queued follow-up workers re-check sequence and must not send.

**No automatic reply sending.** POSITIVE/QUESTION may generate suggested reply/meeting drafts requiring new approvals.

## CRM sync

After successful send:

- create Twenty Note (checkpointed with `message.id` as webhookLogId key)
- link to person when `targetPersonTwentyId` set

If send succeeds and CRM fails:

- message stays `SENT`
- `crmSyncStatus=FAILED`
- retry via `crmSyncOnly: true` — **never resends email**

Provider send failure → no “sent” CRM note.

## Meeting booking

POSITIVE reply → meeting draft + `SdrMeetingBooking` PROPOSED.

Confirm: `POST .../meetings/confirm` → deterministic BOOKED + sequence COMPLETED.

No silent calendar booking without this flow.

## Admin APIs

| Method | Path |
|---|---|
| POST | `/prospects/:candidateId/sdr` |
| POST | `/sdr/sequences/:sequenceId/drafts` |
| GET | `/sdr/sequences/:sequenceId` |
| GET | `/sdr/drafts/:draftId` |
| POST | `/sdr/drafts/:draftId/approve` |
| POST | `/sdr/drafts/:draftId/revoke` |
| POST | `/sdr/drafts/:draftId/send` |
| POST | `/sdr/sequences/:sequenceId/replies` |
| POST | `/sdr/sequences/:sequenceId/meetings/confirm` |

## Audit

`sdr_sequence_created`, `sdr_draft_generated`, `sdr_draft_superseded`, `sdr_approval_granted`, `sdr_approval_revoked`, `sdr_send_blocked_unapproved`, `sdr_send_started`, `sdr_sent`, `sdr_send_failed`, `sdr_reply_received`, `sdr_sequence_paused_on_reply`, `sdr_reply_draft_generated`, `sdr_crm_sync_completed`, `sdr_crm_sync_failed`, `sdr_meeting_booking_started`, `sdr_meeting_booked`

## Tenant isolation

Cross-tenant sequence/draft/approve/send/reply → 404/fail closed.

## Known limitations

- Deterministic outbound/meeting only (no production ESP/calendar)
- No mass campaigns or autonomous multi-step blanket approval
- No email guessing / contact scraping
- No auto-reply send
- Person note link requires explicit `targetPersonTwentyId`
- Production provider idempotency depends on ESP support; deterministic provider simulates it

## Version

`ai-sdr-v1`
