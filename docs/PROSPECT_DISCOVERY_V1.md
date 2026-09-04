# Prospect Discovery v1 (ZEX-33)

Canonical **Prospect Discovery** lives in **ZEX-Platform**. Candidates are Platform-owned until explicit approval. Twenty / ZEX-CRM receives only approved company creates.

## Dependency

Requires a **ready** Company Brain (`status=ready` + payload) for ICP, personas, and qualification rules.

## Data model

- `ProspectDiscoveryRun` — tenant-scoped run (`queued|processing|completed|failed`)
- `ProspectCandidate` — proposed company with fit, dedupe, buyer roles (JSON), evidence, CRM ids

Buyer roles are abstract committee roles (not invented named people).

## Provider abstraction

`ProspectDiscoveryProvider` → `ProspectDiscoveryProviderService`

- Default/test: `DeterministicProspectDiscoveryProvider`
- Env: `PROSPECT_DISCOVERY_DETERMINISTIC=true` (also preferred when `NODE_ENV=test`)
- Provider output validated with Zod before persistence

Deterministic fixture returns:

1. Strong ICP match (`northwind-analytics.example`)
2. Disqualified (`consumer` industry)
3. CRM duplicate domain (`acme-duplicate.example`)
4. New valid candidate (`brightline-*.example`)

## Fit scoring

`assessIcpFit` explains ICP fit (not Why-Now):

- Industry / size / geography matches
- ICP disqualifiers
- Qualification rule evaluation (positive/negative)
- `fitScore` 0–100 + `fitBand` (`strong|moderate|weak|disqualified`)

## Buyer roles

Mapped from Company Brain personas via `mapBuyerRolesFromPersonas`.

- Includes `matchedCompanyBrainPersonaId`, confidence, evidence
- **Does not** create Twenty Person records from abstract roles

## CRM company dedupe

Priority:

1. Exact normalized **domain** → `EXACT_MATCH` (store `existingTwentyCompanyId`, status `DUPLICATE`, no create)
2. Exact **name** when candidate has domain but no domain hit → `POSSIBLE_MATCH` (no auto-create in v1)
3. Exact **name** when candidate has **no domain** → `EXACT_MATCH`
4. Else `NEW`

Re-dedupe runs immediately before CRM write.

## Person dedupe / creation

v1 does **not** create People for buyer roles. No placeholder “VP Sales” contacts.

## Approval-first workflow

1. Discover → candidates only (`PROPOSED` / `DUPLICATE`)
2. Review via GET run/candidates
3. Approve / Reject explicitly
4. Create only if `APPROVED` (or retry `FAILED`)
5. Unapproved / rejected / exact duplicates cannot be written

## Idempotent CRM creation

Uses `JobActionCheckpoint` with:

- `webhookLogId` = `prospectCandidateId` (correlation id)
- `action` = `create_company`
- Stores Twenty company id in `externalId`

Retries reuse checkpoint / `createdTwentyCompanyId` and do not create a second company.

## API

Base: `api/v1/admin/tenants/:tenantId/prospect-discovery`

| Method | Path | Purpose |
|---|---|---|
| POST | `/` | Start discovery (`companyBrainId`, optional `limit`, `sync`) |
| GET | `/:runId` | Run status + candidates |
| GET | `/:runId/candidates` | List candidates |
| GET | `/candidates/:candidateId` | Candidate detail |
| POST | `/candidates/:candidateId/approve` | Approve |
| POST | `/candidates/:candidateId/reject` | Reject |
| POST | `/candidates/:candidateId/create` | Create approved in Twenty |
| POST | `/candidates/:candidateId/retry-create` | Idempotent retry |

Auth: `AdminApiKeyGuard`. Tenant from path after admin auth.

## Tenant isolation

All reads/writes scoped by `tenantId`. Cross-tenant access → 404.

## Audit

- `prospect_discovery_run_created`
- `prospect_discovery_completed` / `prospect_discovery_failed`
- `prospect_candidate_proposed`
- `prospect_candidate_duplicate_detected`
- `prospect_candidate_approved` / `prospect_candidate_rejected`
- `prospect_candidate_crm_created` / `prospect_candidate_crm_create_failed`

## Out of scope

Why-Now / intent, research agent, outreach/email, Today feed, Agent Control Center, deep Prospects UI.
