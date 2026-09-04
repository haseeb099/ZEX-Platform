# Company Brain v1 (ZEX-32)

Canonical **Company Brain** intelligence lives in **ZEX-Platform**. Twenty / ZEX-CRM is a presentation layer only — this service does **not** couple persistence to Twenty object schemas.

## Ownership

| Concern | Owner |
|---|---|
| Source ingestion, analysis, structured memory, evidence, edits | ZEX-Platform |
| Optional CRM UI to view/edit later | ZEX-CRM (out of scope for ZEX-32) |

## Data model

Tenant-scoped aggregate:

- `CompanyBrain` — companyName, websiteUrl, status (`draft` \| `analyzing` \| `ready` \| `failed`), version, `generatedPayload`, `payload`, `userOverrides`
- `CompanyBrainSource` — WEBSITE \| URL \| PASTED_TEXT \| DOCUMENT_TEXT, optional URL/title, normalized `rawText`, `contentHash` (unique per brain)
- `CompanyBrainAnalysisJob` — durable async analysis status

Structured `payload` (Zod-validated) includes:

1. **ICP** — industries, company size, geography, use cases, buying triggers, disqualifiers + evidence
2. **Personas** — role, seniority/function, goals, pains, objections, buying influence + evidence
3. **Pain points** — statement, severity + evidence
4. **Competitors / alternatives** — name, category, differentiation, `certainty` (`supported` \| `inferred` \| `uncertain`) + evidence
5. **Qualification rules** — machine-readable polarity/field/operator/value + evidence
6. **Messaging summary** — one-liner, value props, differentiators, objections, proof points, themes + evidence

## Evidence / provenance

Every generated conclusion carries `evidence[]`:

- `sourceId`, bounded `excerpt` (≤500 chars), optional URL/title/locator
- `confidence` (0–1)
- `evidenceType`: `EXPLICIT` \| `INFERRED`

LLM/analyzer output alone is never treated as evidence; snippets must reference ingested sources. Prefer empty/null over unsupported invention (e.g. competitors only when named in sources).

## Source ingestion & SSRF

URL fetches go through `safeFetchText`:

- Allow only `http`/`https`
- Reject localhost, loopback, RFC1918, link-local, CGNAT, cloud metadata IPs
- DNS resolution re-checked for private addresses
- Timeout, max bytes (~512KB), redirect limit (3), content-type checks
- HTML stripped to text before hashing/storage

Text sources are normalized and content-hashed. Re-submitting the same content returns the existing source (`duplicated: true`) — no duplicate rows.

## Analyzer abstraction

`CompanyBrainAnalyzer` interface + `CompanyBrainAnalyzerService` facade.

- Default / test: `DeterministicCompanyBrainAnalyzer` (no LLM credentials required)
- Future: inject LLM-backed provider via `COMPANY_BRAIN_ANALYZER` without changing persistence
- Env: `COMPANY_BRAIN_DETERMINISTIC=true` forces deterministic path; `NODE_ENV=test` also prefers it
- All analyzer output is validated with Zod before persistence

## Async workflow

`POST .../analyze` and `POST .../regenerate` enqueue BullMQ queue `company-brain-analyze`.

- Durable `CompanyBrainAnalysisJob` row tracks status
- Job payload `tenantId` is set server-side from the authenticated admin path
- Optional `{ "sync": true }` runs analysis inline (admin/debug + contract tests)

## Human-edit / regeneration semantics

**v1 rule:** human overrides are sticky.

- Edits mark sections/items in `userOverrides`
- `generatedPayload` always stores the latest AI draft
- Effective `payload` is merged via `mergeGeneratedPayload`:
  - overridden `icp` / `messagingSummary` keep human values
  - list items (personas, pains, competitors, rules) with override flags keep human values by `id`
  - non-overridden sections/items take the new generated draft

Regeneration **never** silently overwrites protected human edits.

## API (admin Bearer)

Base: `api/v1/admin/tenants/:tenantId/company-brain`

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | List brains for tenant |
| POST | `/` | Create (+ optional sources + optional analyze) |
| GET | `/:brainId` | Get brain + sources + payload/evidence |
| POST | `/:brainId/sources` | Add source |
| POST | `/:brainId/analyze` | Analyze (async or sync) |
| GET | `/:brainId/analysis-jobs/:jobId` | Job status |
| PATCH | `/:brainId` | Edit structured sections |
| PUT | `/:brainId/personas` | Upsert persona |
| DELETE | `/:brainId/personas/:personaId` | Remove persona |
| PUT | `/:brainId/qualification-rules` | Upsert rule |
| PATCH | `/:brainId/messaging` | Edit messaging summary |
| POST | `/:brainId/regenerate` | Re-analyze with override merge |

Auth: `AdminApiKeyGuard`. Tenant is resolved from the path **after** admin auth; client-supplied tenantId is never trusted without that guard + DB existence check (`deletedAt: null`). Every query scopes `tenantId`.

## Audit

Meaningful mutations write `AuditLog` (no full source bodies):

- `company_brain_created`
- `company_brain_source_added` (hash + lengths, not raw text)
- `company_brain_analyzed` / `company_brain_analyze_failed`
- `company_brain_edited`
- `company_brain_persona_upserted` / `company_brain_persona_removed`
- `company_brain_qualification_rule_edited`
- `company_brain_messaging_edited`

## Tenant isolation

Tenant A cannot read/modify Tenant B brains, attach sources, or retrieve Tenant B analysis jobs (404). Covered by contract tests.

## Future use

Payload + qualification rules are designed for later **Prospect Discovery** and **Why-Now** without schema rewrites. Those products are **out of scope** for ZEX-32.

## Explicitly out of scope (ZEX-32)

- Prospect Discovery / enrichment of prospect lists
- Why-Now scoring / Research Agent
- Outbound email generation/sending
- Today feed / Agent Control Center
- Deep ZEX-CRM UI
