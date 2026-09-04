# Why-Now + Intent Scoring v1 (ZEX-34)

Canonical **Why-Now** scoring lives in **ZEX-Platform**. It prioritizes `ProspectCandidate` records using Company Brain ICP + typed signals. It does **not** write to Twenty / ZEX-CRM.

## Relationships

- **Company Brain (ZEX-32):** ICP, qualification rules, buying triggers, personas
- **Prospect Discovery (ZEX-33):** candidates to score; approval-first CRM create is unchanged
- **Why-Now (ZEX-34):** fit + intent + timing + confidence + concise explanation

## Scores (0–100)

| Score | Meaning |
|---|---|
| `fitScore` | ICP fit via reused `assessIcpFit` |
| `intentScore` | Evidence of relevant buying interest / change |
| `timingScore` | Whether evidence is timely (freshness + decay) |
| `overallScore` | Weighted prioritization |

### Overall formula

```text
overall = round(
  fitScore    * 0.40 +
  intentScore * 0.35 +
  timingScore * 0.25
)
```

Weights are explicit constants (`WHY_NOW_WEIGHTS` in code).

## Fit

Reuses ZEX-33 `assessIcpFit` — industry, size, geography, disqualifiers, qualification rules.

No second contradictory fit algorithm.

## Intent

Built only from typed `ProspectSignal` records.

- No signals → low/neutral intent (~15) — **does not invent evidence**
- Positive signals add based on type, confidence, relevance, buying-trigger alignment
- Negative / conflict signals reduce intent and confidence
- Disqualified ICP caps intent enthusiasm

## Timing + decay

Timing uses signal `occurredAt` age:

| Age | Decay factor |
|---|---|
| ≤ 7 days | 1.0 |
| 8–30 days | 0.7 |
| 31–90 days | 0.35 |
| 91–180 days | 0.15 |
| > 180 days | 0.05 |

Buying-trigger aligned signals contribute more before decay.

## Confidence (0–1)

Distinct from overall score. Considers:

- evidence count
- source confidence
- freshness
- trigger alignment
- conflicts / disqualifiers

Sparse data → lower confidence even if fit is high.

## Why Now explanation

Deterministic 1–3 sentence template grounded in score reasons and signal titles.

Does not invent facts absent from evidence.

## Signal model

`ProspectSignal`: tenant-scoped, provenance-backed, timestamped, deduped by `dedupeKey`.

Categories/types are Zod-validated (`crm_migration`, `hiring`, `funding`, …).

## Signal provider

`ProspectSignalProvider` → `ProspectSignalProviderService`

- Default/test: `DeterministicProspectSignalProvider`
- Env: `WHY_NOW_DETERMINISTIC=true` (also preferred when `NODE_ENV=test`)

Fixtures: `strong_why_now`, `no_signal`, `stale_signal`, `bad_fit_recent`, `conflicting`

## Snapshots / history

`ProspectScoreSnapshot` is append-only.

Rescore creates a **new** snapshot; prior scores remain for audit / later ranking.

`scoringVersion` = `why-now-v1`

## Signal dedupe

`dedupeKey = sha256(candidateId|type|source|occurredAt(date)|title|summary)`

Unique per `(tenantId, dedupeKey)`. Re-ingest → `signal_duplicate_detected`, no duplicate row.

## API

Base: `api/v1/admin/tenants/:tenantId`

| Method | Path | Purpose |
|---|---|---|
| POST | `/prospects/:candidateId/signals` | Ingest typed signals |
| POST | `/prospects/:candidateId/why-now` | Score (`sync`, `collectSignals`, `fixture`) |
| GET | `/prospects/:candidateId/why-now` | Latest snapshot + signals |
| GET | `/prospects/:candidateId/why-now/history` | Snapshot history |
| POST | `/prospect-discovery/:runId/why-now` | Optional batch score |

Auth: `AdminApiKeyGuard`. Never auto-writes CRM companies.

## Queue

`WHY_NOW_QUEUE` (`why-now-score`) for async scoring. Sync mode for tests/admin.

## Tenant isolation

All reads/writes scoped by path `tenantId` after admin auth. Cross-tenant → 404.

## Audit

- `signal_ingested` / `signal_duplicate_detected`
- `why_now_scored` / `why_now_rescored` / `why_now_score_failed`

## Out of scope

Autonomous research, named-contact research, outreach/email, Today feed UI, Agent Control Center, production intent-vendor wiring, Twenty custom Why-Now fields.
