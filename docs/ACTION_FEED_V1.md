# Action Feed v1 (ZEX-37)

Aggregation API that powers the CRM `/zex/today` screen.

## Endpoint

`GET /api/v1/admin/tenants/:tenantId/action-feed?limit=50`

Admin API key required (CRM server proxies; browser never sees the key).

Also:

- `GET /api/v1/admin/tenants/by-workspace/:workspaceId` — resolve Platform `tenantId` from Twenty workspace id
- `POST /api/v1/admin/tenants/:tenantId/sdr/drafts/:draftId/reject` — durable draft `REJECTED`

## Prioritization (deterministic)

Higher `rankScore` first:

| Type | Base rank | Priority label |
|------|-----------|----------------|
| `meeting_opportunity` | 1000 | critical |
| `reply_review` | 900 | critical |
| `sdr_draft_approval` | 700 | high |
| `workflow_blocked` | 600 | high |
| `prospect_approval` | 400 | medium |

Plus `min(100, overallScore) * 2` boost from latest Why-Now snapshot when present.

Tie-break: overall score ↓, `updatedAt` ↓, stable `id` ↑.

## Dedupe

One card per `prospectCandidateId`. Downstream wins (meeting > reply > draft approval > blocked > prospect).

Example: high Why-Now + research ready + SDR draft awaiting approval → single **Approve outreach draft** card.

## Evidence

Cards include bounded Why-Now text, score breakdown, draft preview / doNotClaim, or reply summary — never unsupported claims.

## Mutations from Today

Today calls existing Platform APIs (via CRM proxy):

- approve/reject prospect
- approve/reject SDR draft
- confirm meeting

**Approving a draft does not send.** Send remains a separate exact-approval API.

## Reject draft semantics

`REJECTED` is durable and distinct from `SUPERSEDED` / approval revoke.

- cannot approve or send
- revokes any active approval
- auditable as `sdr_draft_rejected`
- new draft generation still allowed later

## Version

`action-feed-v1`
