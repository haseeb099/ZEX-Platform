# Twenty Automation Backend (ZEX Connect MVP)

Decoupled NestJS microservice beside Twenty CRM: webhooks → enrich → score → auto-opportunity → audit.

## Quick start

```bash
cp .env.example .env
docker compose up -d
npm install
npx prisma migrate dev --name init
npm run dev
curl http://localhost:3000/health
```

> Local ports: Postgres **5434**, Redis **6380** (avoids clashes with other stacks on 5432/6379).

Swagger: http://localhost:3000/docs

### Create a tenant

```bash
curl -X POST http://localhost:3000/api/v1/admin/tenants \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Demo","twentyWorkspaceId":"ws_1","twentyApiKey":"sk_xxx"}'
```

### Admin API key

Default local: `ADMIN_API_KEY` from `.env` (Bearer token).

## Stack

NestJS + Fastify · PostgreSQL + Prisma · BullMQ + Redis · graphql-request · Zod/Joi · Pino

## Docs

- `docs/TWENTY_AUTOMATION_BACKEND_HANDOFF.md`
- `docs/COMPLETE_STARTER_SCAFFOLD.md`
- `docs/README_GETTING_STARTED.md`
- Notion: https://app.notion.com/p/3bedd43e0a9d8002b5d9d0b7246e7115
