# ZEX Platform

ZEX Platform is the proprietary revenue intelligence, automation and agent layer behind ZEX Connect.

It runs beside ZEX CRM (the pinned Twenty-based operational CRM shell) and owns customer memory, enrichment, scoring, Why-Now, research, agents, approvals, audit, integrations and revenue workflow automation.

## Repository responsibility

**ZEX Platform owns:**
- tenant and connection orchestration
- CRM event ingestion and queues
- enrichment and scoring
- customer memory and revenue intelligence
- agent runtime and agent actions
- evidence, confidence, approvals and audit
- integrations and automation workflows

**ZEX CRM owns:**
- operational CRM records and pipeline state
- the customer-facing ZEX CRM shell and native app experience
- the pinned Twenty runtime and safe upstream upgrade path

The two repositories integrate through webhooks plus deterministic REST/GraphQL contracts. MCP/tool adapters are for agent tool use, not primary data synchronization.

## Quick start

```bash
cp .env.example .env
docker compose up -d
npm ci
npx prisma migrate dev --name init
npm run dev
curl http://localhost:3000/health
```

Local defaults use Postgres on **5434** and Redis on **6380** to reduce conflicts with other development stacks.

Swagger: `http://localhost:3000/docs`

## Environment model

Supported runtime environments:
- `development` — local development
- `test` — automated tests and CI
- `staging` — production-like integration and smoke testing
- `production` — customer traffic

Never reuse production secrets or databases in development/test. Production and staging must use separately managed secrets and database/Redis instances.

## Create a tenant

```bash
curl -X POST http://localhost:3000/api/v1/admin/tenants \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Demo","twentyWorkspaceId":"ws_1","twentyApiKey":"sk_xxx"}'
```

`ADMIN_API_KEY` is a bootstrap administrative control only. It must be high entropy and will later be replaced by authenticated workspace/user RBAC for customer-facing administration.

## Stack

NestJS + Fastify · PostgreSQL + Prisma · BullMQ + Redis · graphql-request · Joi/Zod · Pino

## Current engineering gates

Every pull request must pass:
- dependency install
- Prisma generate + schema validation
- ESLint/Prettier
- unit tests
- E2E tests
- NestJS build

## Documentation

Legacy backend handoff/scaffold docs remain under `docs/` as implementation history. The active product/architecture Single Source of Truth is maintained in the ZEX Connect Notion project.
