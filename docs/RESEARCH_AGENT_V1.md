# Research Agent v1 (ZEX-35)

Platform-owned research for **approved** prospect accounts. Stores source-backed findings and produces outreach **context** for a later SDR agent (ZEX-36).

## Scope

- Research **APPROVED** or **CREATED** `ProspectCandidate`s only
- Persist provenance-backed findings + research package history
- Build grounded outreach context (`doNotClaim`, evidenced personalization)
- **Zero** implicit Twenty/CRM writes

Out of scope: sending email, autonomous SDR sequences, contact enrichment at scale, silent CRM updates, Today feed, Agent Control Center, production-scale scraping.

## Architecture

```
Company Brain → Prospect Discovery → Why-Now → [approve] → Research Agent
```

Module: `src/research-agent/`

- `ResearchAgentService` — approval gate, run lifecycle, persistence, package build
- `ProspectResearchProvider` + deterministic fixtures
- BullMQ queue `prospect-research`
- Admin APIs under `api/v1/admin/tenants/:tenantId`

`ResearchAgentModule` deliberately does **not** import `TwentyModule`.

## Approval gate

| Status | Research |
|---|---|
| `APPROVED` | Allowed |
| `CREATED` | Allowed (already approved account) |
| `PROPOSED` | Blocked |
| `DUPLICATE` | Blocked |
| `REJECTED` | Blocked |
| `FAILED` | Blocked |

A high Why-Now score is **prioritization, not authorization**.

### Worker re-check

Approval is checked at enqueue **and again** when the worker executes. If the candidate is no longer researchable, the run becomes `BLOCKED` and audit `research_blocked_not_approved` is written.

## Models

### ProspectResearchRun

Statuses: `QUEUED` | `PROCESSING` | `COMPLETED` | `FAILED` | `BLOCKED`

Stores a self-contained `package` JSON snapshot, confidence, optional `whyNowSnapshotId`, finding count, provider, errors.

### ProspectResearchFinding

Source-backed finding with claim, excerpt, source URL/title/type, confidence/relevance, optional named person fields, `stale` flag, and `dedupeKey`.

Unique: `(tenantId, dedupeKey)`.

## Provider abstraction

`ProspectResearchProvider.research(context) → Zod-validated findings`.

Env: `RESEARCH_AGENT_DETERMINISTIC=true` (also preferred when `NODE_ENV=test`).

### Deterministic fixtures

| Fixture | Behavior |
|---|---|
| `strong_research` | Overview, CRM change, hiring, product, ICP, named leader, outreach hook |
| `sparse_research` | Basic overview only |
| `conflicting_research` | Positive CRM + objection/budget freeze |
| `stale_research` | Old CRM evidence labeled stale |
| `no_research` | Empty findings; successful sparse package |
| `provider_failure` | Throws; run `FAILED` |

## Source / provenance rules

- Every factual finding needs excerpt and/or source metadata
- Excerpts capped at 500 chars
- Source URLs normalized for dedupe
- Named people require the name to appear in finding text/excerpt
- Never invent CEO/VP/email without evidence
- ZEX-33 buyer **roles** ≠ named people

## Confidence

Research confidence is **separate** from Why-Now overall score. It considers finding count, source presence, corroboration, freshness/staleness, and conflicts.

## Research package

- Company summary
- Why relevant (ICP mapping)
- Why now (reuses latest ZEX-34 snapshot text/id — does not re-score)
- Key findings (≤8)
- Buying committee: likely roles + source-backed named people only
- Risks / objections
- Outreach context

## Outreach context

```json
{
  "primaryAngle": "...",
  "supportingPoints": ["..."],
  "personalizationFacts": ["..."],
  "risks": ["..."],
  "doNotClaim": ["..."],
  "suggestedBuyerRoles": ["VP Sales"]
}
```

- `personalizationFacts` must map to persisted findings
- `doNotClaim` blocks unsupported funding/CRM/named-contact/stale/overconfidence claims
- Unsupported phrases like “Congrats on your Series B…” are rejected unless evidenced

## Why-Now relationship

Research **reads** the latest `ProspectScoreSnapshot`. It does not reimplement scoring.

### Signal integration (v1)

**Option A:** Research stores findings only. It does **not** auto-ingest Why-Now `ProspectSignal`s. A future explicit rescore can consume research if desired.

## Idempotency

Dedupe key: candidate + finding type + normalized claim + source URL + date + person name.

Repeated runs create new run history rows; identical findings are reused (`research_finding_duplicate_detected`) and do not multiply rows.

## History

Prior runs remain. `GET .../research/latest` returns the newest **COMPLETED** run only. Failed runs never become latest (no package).

## Queue

`prospect-research` → `ProspectResearchProcessor` → `executeResearch` with live approval re-check.

## Failure semantics

- Provider/fetch failure → run `FAILED`, bounded error, `package` null
- Prior successful research remains via latest endpoint
- Retry allowed via new `POST .../research`

## Tenant isolation

Cross-tenant start/read/history → **404**.

## Audit

- `research_run_created`
- `research_started`
- `research_completed`
- `research_failed`
- `research_blocked_not_approved`
- `research_finding_created`
- `research_finding_duplicate_detected`

Summaries only — no raw page bodies or secrets.

## No silent CRM mutation

Research Agent performs **zero** company/person/note/opportunity/tag writes. Contract spies assert Twenty mutation methods are not called.

## API

| Method | Path |
|---|---|
| POST | `/api/v1/admin/tenants/:tenantId/prospects/:candidateId/research` |
| GET | `/api/v1/admin/tenants/:tenantId/prospects/:candidateId/research/latest` |
| GET | `/api/v1/admin/tenants/:tenantId/prospects/:candidateId/research/history` |
| GET | `/api/v1/admin/tenants/:tenantId/prospects/:candidateId/research/:runId` |

Body (deterministic/test): `{ "sync": true, "fixture": "strong_research" }`

## Limitations

- Deterministic provider only in v1 (no production web research vendor)
- No uncontrolled scraping; SSRF-safe fetch available for future URL sources
- No automatic Why-Now signal emission from findings
- No CRM writeback
- Outreach context is structured guidance, not sendable copy automation

## Version

`researchVersion = research-agent-v1`
