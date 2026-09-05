# Agent Control Center v1 (ZEX-39)

Durable Platform API/state for CRM `/zex/agents`. Answers: what agents are doing, what they are allowed to do, what needs approval, what changed, and what can be safely undone.

## Version

`agent-control-v1`

## Endpoints

Admin API key required (CRM server proxies; browser never sees the key).

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/v1/admin/tenants/:tenantId/agents` | Overview of implemented agents |
| `GET` | `/api/v1/admin/tenants/:tenantId/agent-actions` | Normalized action history |
| `POST` | `/api/v1/admin/tenants/:tenantId/agents/:agentId/pause` | Pause agent |
| `POST` | `/api/v1/admin/tenants/:tenantId/agents/:agentId/resume` | Resume agent |
| `POST` | `/api/v1/admin/tenants/:tenantId/agent-actions/:actionId/undo` | Undo reversible control mutation |

Existing audit endpoint is unchanged:

`GET /api/v1/admin/tenants/:tenantId/audit`

Query params:

- overview: `recentLimit` (1–50, default 10)
- actions: `agentId`, `limit` (1–100), `offset`

Unknown `agentId` → `404`. Unknown tenant → `404`.

## Implemented agents (v1)

Only agents that exist in Platform runtime:

| id | Name |
|----|------|
| `research_agent` | Research Agent |
| `ai_sdr` | AI SDR |

Meeting/Deal Agent is **not** a Platform runtime agent in v1. CRM may show a disabled static placeholder; Platform does not invent fake state for it.

## Status model

Precedence (highest first):

```text
paused > blocked > degraded > active > idle
```

| Status | Meaning |
|--------|---------|
| `paused` | `TenantAgentControl.state = PAUSED` |
| `blocked` | Recent blocked runs and no current work (research) / send-blocked audits (SDR) |
| `degraded` | Elevated recent failures |
| `active` | Current work or awaiting approval |
| `idle` | No current work |

## Permissions model

Explicit stable capabilities (not company-wide RBAC):

```ts
{ key, label, mode: 'allowed' | 'approval_required' | 'not_allowed' | 'human_only', description }
```

### Research Agent

- `research_accounts` → allowed
- `read_why_now` → allowed
- `write_research_findings` → allowed
- `produce_outreach_context` → allowed
- `mutate_crm` → not_allowed
- `send_outreach` → not_allowed

### AI SDR

- `read_research` → allowed
- `draft_outreach` → allowed
- `approve_draft` → human_only
- `send_outreach` → approval_required
- `adapt_after_reply` → allowed (draft suggestions only)
- `book_meeting` → approval_required
- `crm_sync` → allowed (existing workflow)
- `auto_send` → not_allowed

## Approval model

Derived from authoritative domain tables / audit — no second approval store.

Examples: `awaiting_approval`, `approved`, `rejected`, `superseded`, `meeting_awaiting_confirmation`, `sent`, `send_blocked`.

Approval-first send and reject-draft semantics are unchanged from ZEX-36/37.

## Action history

Each surfaced action includes:

- action id (= audit log id)
- agent id (or omitted if unmapped)
- action type, status, timestamps
- subject/resource
- evidence summary (bounded)
- confidence (`number` \| `null` \| `not_applicable` — never fabricated)
- permission key
- approval state
- triggeredBy
- mutation before/after (redacted + bounded)
- reversible + undo state
- audit reference

### Audit → agent mapping

- `research_*` (known set) → `research_agent`
- `sdr_*` (known set) → `ai_sdr`
- `agent_control_*` → agent id from payload
- Unknown / unmapped audit rows are **not** attributed

## Pause / resume

Persisted in `TenantAgentControl` (`tenantId` + `agentId` unique). Absent row = `ACTIVE`.

Audited as `agent_control_paused` / `agent_control_resumed` with before/after and `reversible: true`.

### Pause enforcement (entry points)

**Research Agent (`research_agent`)**

| Entry | When paused |
|-------|-------------|
| `startResearch` | Fail closed (`400`) before enqueue/sync |
| `executeResearch` (worker) | Run → `BLOCKED`; audit `research_blocked_agent_paused` |

Completed history remains visible.

**AI SDR (`ai_sdr`)**

| Entry | When paused |
|-------|-------------|
| `createSequence` | Fail closed |
| `createDraft` | Fail closed |
| `sendDraft` / `executeSend` | Fail closed |
| `ingestReply` | **Continues** — records reply, stops/cancels sequence, unsubscribe/negative handling |
| Reply adaptation drafts | **Skipped** while paused (no new agent progression) |
| Human approve/reject draft | Unaffected (human control) |
| CRM sync of already-sent | Unaffected |

Inbound replies/unsubscribe safety must never be paused.

## Undo model

Only **agent control** mutations are reversible in v1:

- pause → undo restores previous control state (typically `ACTIVE`)
- resume → undo restores previous control state (typically `PAUSED`)

### Latest-effective eligibility (required)

Only the **latest effective un-undone** pause/resume for a tenant + agent may be undone.

Timeline example:

```text
A pause → PAUSED
B resume → ACTIVE
C pause → PAUSED
undo A → 409 Conflict (superseded)
undo B → 409 Conflict (superseded)
undo C → succeeds (restores ACTIVE)
```

After undoing C, older A/B stay **superseded** (conservative: no multi-level undo stack / no resurrection).

Server enforces this before mutating `TenantAgentControl` or writing undo audit. UI visibility is not the safety gate.

### Undo status in action history

| `undo.status` | Meaning |
|---------------|---------|
| `available` | Latest effective pause/resume; may be undone |
| `undone` | Already undone (idempotent second undo) |
| `superseded` | Historical pause/resume replaced by newer control activity |
| `not_reversible` | Domain / control-undo events that cannot be undone |

`reversible: true` may still appear on historical pause/resume rows (mutation class), but `undo.status` must be `superseded` when not currently eligible.

Rules:

- Tenant-scoped
- Idempotent second undo of the same action
- Rejects superseded (`409`), irreversible / unknown / cross-tenant actions
- Writes new `agent_control_undo` audit (history preserved; original rows never deleted)
- Never unsends email, rolls back CRM, cancels/books meetings, or reverses reply handling

### Action history pagination

`GET .../agent-actions` scans a finite newest-first window (`historyWindowLimit`, default 500 AuditLog rows). Response `total` is the mapped count **within that window**, not a global DB total. `historyWindowComplete: true` means fewer raw rows than the window were found.

### Reversible

- `agent_control_paused`
- `agent_control_resumed`

### Irreversible (examples)

- `sdr_sent` / outbound email
- `sdr_meeting_booked`
- `sdr_reply_received`
- `research_completed` / findings
- CRM creates / sync completions
- Draft approvals / rejects
- Superseded historical pause/resume (reject undo; do not mutate)

## Tenant isolation

All reads/mutations scoped by `tenantId`. Cross-tenant pause/resume/undo fail closed (`404` for unknown action in tenant). Preserves ZEX-37 fail-closed workspace→tenant mapping.

## Non-goals

- Generic multi-agent orchestration / workflow builder
- Autonomous permission editing
- Sending without approval / Control Center auto-send
- Generic CRM transaction rollback / email unsend
- Fake Meeting/Deal Agent runtime
- Broad analytics / notification center

## Preserve

Company Brain, Prospect Discovery, Why-Now, Research evidence rules, AI SDR exact approval, no auto-send, reply stop/unsubscribe, meeting confirmation, Action Feed, fail-closed tenant resolution.
