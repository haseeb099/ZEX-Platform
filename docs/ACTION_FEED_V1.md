# Action Feed v1 (ZEX-37)

Aggregation API that powers the CRM `/zex/today` screen.

## Endpoint

`GET /api/v1/admin/tenants/:tenantId/action-feed?limit=50`

Admin API key required (CRM server proxies; browser never sees the key).

Also:

- `GET /api/v1/admin/tenants/by-workspace/:workspaceId` — resolve Platform `tenantId` from Twenty workspace id (fail-closed: exactly one active non-deleted `TwentyConnection`; ambiguous duplicates → `409`; unknown → `404`)
- `POST /api/v1/admin/tenants/:tenantId/sdr/drafts/:draftId/reject` — durable draft `REJECTED`

## Prioritization (deterministic)

**Type precedence is absolute.** Downstream action types always outrank upstream ones, regardless of Why-Now / overall score:

```text
meeting_opportunity
>
reply_review
>
sdr_draft_approval
>
workflow_blocked
>
prospect_approval
```

| Type | `TYPE_RANK` / `rankScore` | Priority label |
|------|---------------------------|----------------|
| `meeting_opportunity` | 1000 | critical |
| `reply_review` | 900 | critical |
| `sdr_draft_approval` | 700 | high |
| `workflow_blocked` | 600 | high |
| `prospect_approval` | 400 | medium |

**Why-Now score only orders within the same action tier/type.** It must never cross type boundaries (e.g. a reply with score 100 cannot outrank a meeting with score 0).

Sort and dedupe use explicit comparison dimensions (not a single overlapping numeric blend):

1. `TYPE_RANK` (absolute)
2. overall / Why-Now `score` (within tier)
3. `updatedAt` (newer first)
4. stable `id` (ascending)

`rankScore` in the API mirrors `TYPE_RANK` only (UI/debug). It does not include score boosts.

## Dedupe

One card per `prospectCandidateId`. **Downstream-wins** semantics: keep the item that ranks higher under the same comparison as feed sort (type → score → `updatedAt` → `id`).

Example: high Why-Now + research ready + SDR draft awaiting approval → single **Approve outreach draft** card (draft beats prospect; meeting/reply would beat draft).

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
