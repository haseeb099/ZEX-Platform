---
name: implement-twenty-automation
description: >-
  Implement NestJS Twenty CRM automation backend features from the scaffold and
  handoff docs. Use when building webhooks, tenants, enrichment, scoring, jobs,
  Twenty GraphQL write-back, audit, or Phase 0–1 MVP tasks for ZEX Connect.
---

# Implement Twenty Automation

## Steps

1. Open the matching Notion task; set Status → **In progress**; Activity Log **Update**.
2. Read relevant sections of `docs/TWENTY_AUTOMATION_BACKEND_HANDOFF.md`.
3. Copy/adapt from `docs/COMPLETE_STARTER_SCAFFOLD.md` before inventing files.
4. Implement the vertical slice (module + tests).
5. Ensure mutations write **AuditLog** with before/after.
6. Run targeted Jest tests.
7. Set task **Done**; Activity Log **Update** with acceptance evidence.

## Constraints

- NestJS + Fastify, Prisma, BullMQ, graphql-request, Zod, Pino.
- Webhooks: verify HMAC → ACK 200 → enqueue.
- No Twenty UI/fork work in MVP.
- Never commit secrets.
