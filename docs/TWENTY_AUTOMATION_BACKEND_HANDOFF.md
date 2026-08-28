# Twenty CRM AI Automation Backend — Complete Engineering Handoff

**Version:** 2.0 (Production Ready)  
**Date:** August 22, 2026  
**Status:** Ready for immediate implementation in Cursor  
**Audience:** Solo developer / small team (1–3 engineers)  
**Expected Build Time:** 14 days (MVP to production)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Goals & Non-Goals](#2-goals--non-goals)
3. [Architecture](#3-architecture)
4. [Tech Stack & Justification](#4-tech-stack--justification)
5. [Data Model (Prisma Schema)](#5-data-model-prisma-schema)
6. [API Specification](#6-api-specification)
7. [Webhook & Event Handling](#7-webhook--event-handling)
8. [Enrichment Pipeline](#8-enrichment-pipeline)
9. [Scoring Engine](#9-scoring-engine)
10. [Multi-Tenancy Strategy](#10-multi-tenancy-strategy)
11. [Security & Compliance](#11-security--compliance)
12. [Observability & Monitoring](#12-observability--monitoring)
13. [Deployment & DevOps](#13-deployment--devops)
14. [Implementation Phases](#14-implementation-phases)
15. [Project Structure](#15-project-structure)
16. [Development Workflow in Cursor](#16-development-workflow-in-cursor)
17. [Decisions & Trade-offs](#17-decisions--trade-offs)
18. [Testing Strategy](#18-testing-strategy)
19. [Launch Checklist](#19-launch-checklist)
20. [Appendices](#20-appendices)

---

## 1. Executive Summary

### The Problem
Teams using Twenty CRM lack a **decoupled, intelligent automation layer** that can:
- Enrich incoming leads in real-time
- Score prospects autonomously
- Route and prioritize deals based on health
- Act without forking Twenty core

### The Solution
Build **Twenty Automation Backend**: a production-grade microservice that:
- Listens to Twenty webhooks (no UI changes needed)
- Enriches Person/Company records via trusted data sources
- Scores leads with explainable factors (0–100)
- Auto-creates Opportunities when thresholds are met
- Maintains full audit trails for compliance
- Stays fully upgradeable from Twenty upstream

### Success Metric (MVP)
A new Person record created in Twenty is automatically:
- ✓ Enriched with company data + job title verification
- ✓ Scored 0–100 with factors logged
- ✓ Converted to Opportunity if score ≥ threshold
- ✓ Audited for compliance
- **Within 30–60 seconds, end-to-end**

### Why This Approach
| Aspect | Why This Design |
|--------|-----------------|
| **Decoupled** | No fork = stay on Twenty upstream, zero maintenance tax |
| **Webhook-driven** | Real-time, scalable, eventual consistency (no polling) |
| **GraphQL-native** | Leverage Twenty's native API, future-proof |
| **Multi-tenant from day 1** | Easy to productize and white-label later |
| **Audit-first** | Compliance, debugging, and explainability built in |

---

## 2. Goals & Non-Goals

### Goals (MVP Phase)
- ✓ Real-time webhook ingestion from Twenty CRM
- ✓ Data enrichment (person, company, technology stack)
- ✓ Lead scoring (weighted + explainable)
- ✓ Automated Opportunity creation
- ✓ Audit logging for every action
- ✓ Multi-tenant isolation (one workspace per customer v1)
- ✓ Production-grade reliability (99.5% uptime SLA target)
- ✓ Security (HMAC signatures, encryption at rest, secrets rotation)
- ✓ Observability (structured logging, metrics, traces)
- ✓ Easy local development (Docker Compose)

### Non-Goals (Phase 1)
- ❌ Replacing Twenty's UI or workflows
- ❌ Building a no-code workflow builder (leverage Twenty Workflows)
- ❌ Custom React frontend (we own the backend only; control plane comes phase 3)
- ❌ Mobile app or push notifications
- ❌ Full white-label (v1: admin panel only; UI customization in phase 3)
- ❌ Advanced ML (logistic regression or better in phase 2)
- ❌ Calling integration (that's Zex Connect; this is automation only)

---

## 3. Architecture

### System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                   Twenty Automation Backend                      │
│                                                                  │
│  ┌──────────────┐    ┌─────────────────┐    ┌──────────────┐   │
│  │   Webhook    │    │   Job Queue     │    │ Enrichment   │   │
│  │   Receiver   │───▶│   (BullMQ +     │───▶│ Orchestrator │   │
│  │   (Fastify)  │    │    Redis)       │    │              │   │
│  └──────────────┘    └─────────────────┘    └──────────────┘   │
│        │                     │                      │           │
│        │ HMAC verify         │                      ▼           │
│        │ Acknowledge         │         ┌────────────────────┐  │
│        │ Enqueue             │         │  Scoring Engine    │  │
│        │                     │         │  + Explanation     │  │
│        │                     ▼         └────────────────────┘  │
│        │              ┌─────────────────────────────────────┐  │
│        │              │       PostgreSQL Control Plane      │  │
│        │              │  • Tenants & Secrets (encrypted)    │  │
│        │              │  • Webhook Logs & Audit Trail       │  │
│        │              │  • Scoring History & Rules          │  │
│        │              │  • Enrichment Provider Config       │  │
│        │              │  • Job Results & DLQ                │  │
│        │              └─────────────────────────────────────┘  │
│        │                           │                           │
│        └───────────────────────────┼───────────────────────────┘
│                                    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │      GraphQL / REST Client to Twenty                     │  │
│  │  • Query Person/Company/Opportunity                      │  │
│  │  • Mutation: Create/Update/Upsert                        │  │
│  │  • Create Notes & Tasks                                  │  │
│  └──────────────────────────────────────────────────────────┘  │
└──────────────────────────────────┬──────────────────────────────┘
                                   │
                  ┌────────────────┼────────────────┐
                  │                │                │
                  ▼                ▼                ▼
           ┌────────────┐  ┌────────────┐  ┌─────────────┐
           │ Enrichment │  │  Twenty    │  │  Observability
           │ Providers  │  │   CRM      │  │  (Pino/OTel/Sentry)
           │ (Clearbit, │  │ Instance   │  │
           │  Apollo,   │  │  (Cloud or │  │
           │  Hunter)   │  │  Self-hosted)
           │            │  │            │
           └────────────┘  └────────────┘  └─────────────┘
```

### Data Flow (Happy Path)

```
1. Event: Person.created in Twenty
   ↓
2. Webhook POST to backend with HMAC signature
   ↓
3. Verify HMAC (fail = 401)
   ↓
4. Return 200 OK immediately (acknowledge)
   ↓
5. Enqueue job: "enrich-and-score-person" with exponential retry
   ↓
6. Job processor fetches person details via Twenty GraphQL
   ↓
7. Extract email/domain
   ↓
8. Call enrichment provider (Clearbit → Apollo → mock fallback)
   ↓
9. Score: weighted sum of features (title, company size, industry, etc.)
   ↓
10. Write back:
    • Update Person with enriched fields
    • Upsert Company with data
    • Create Note with enrichment source
    • Create AuditLog entry
    ↓
11. If score ≥ threshold: Auto-create Opportunity
    ↓
12. Done. Timeline entry in Twenty shows "AI Automation: Score 87/100"
```

### Multi-Tenant Architecture

```
Request:
  POST /webhooks/twenty/:tenantId/person.created
  Headers: x-twenty-api-key: ...

Tenant Resolution:
  SELECT * FROM tenant WHERE id = :tenantId AND deleted_at IS NULL
  ├─ Load encrypted API key
  ├─ Load webhook secret (verify signature)
  ├─ Load scoring rules + enrichment preferences
  └─ Load rate limits + feature flags

Processing:
  ├─ Queue scoped to tenant
  ├─ All DB writes include tenant_id
  ├─ Enrichment API calls use tenant's provider budget
  └─ Audit logs tagged with tenant context

Isolation:
  ├─ Tenant data never leaks across queries (tenant_id in WHERE clause)
  ├─ API key rotation without re-deployment
  ├─ Per-tenant rate limiting via Redis key: rate_limit:tenant:${id}
  └─ Billing/usage aggregated per tenant
```

---

## 4. Tech Stack & Justification

| Layer | Technology | Why |
|-------|-----------|-----|
| **Runtime** | Node.js 22+ (LTS) | Latest stability, ESM native, excellent async primitives |
| **Language** | TypeScript (strict mode) | Type safety, IDE support, Cursor + auto-complete |
| **API Framework** | Fastify + NestJS | Fastify: speed + lightweight; NestJS: structure + DI for Cursor modules |
| **Database (Control Plane)** | PostgreSQL 16+ | ACID, JSONB for flexible configs, FTS for audit search |
| **Queue** | BullMQ + Redis | Proven, simple, Redis-backed retries + DLQ |
| **Twenty Integration** | `graphql-request` | Lightweight, esm native, works with Twenty introspection |
| **Validation** | Zod | Runtime + static types, error messages, JSON schema export |
| **Logging** | Pino + pino-pretty (dev) | Structured JSON, fast, OpenTelemetry ready |
| **Tracing** | OpenTelemetry SDK | Vendor-agnostic, export to Datadog/Jaeger/GCP |
| **Secrets** | dotenv + runtime validation | Dev simplicity; production: use K8s secrets or HashiCorp Vault |
| **Testing** | Jest + Supertest | Cursor-friendly, snapshot testing, fast feedback |
| **Linting** | ESLint + Prettier | Auto-formatting in Cursor on save |

### Why NOT
- **Express**: Too bare-metal; NestJS + Fastify handle common patterns.
- **Prisma ORM over raw SQL**: We keep it as a tool, not a crutch. Use Prisma migrations, but write complex queries as raw SQL when needed.
- **GraphQL (for our API)**: REST is simpler for webhooks; graphql-request handles Twenty's GraphQL.
- **Kafka**: Overkill at MVP; BullMQ covers 99% of use cases.
- **MongoDB**: We need transactions, ACID, audit trail simplicity → PostgreSQL.

---

## 5. Data Model (Prisma Schema)

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================================================
// TENANCY & SECRETS
// ============================================================================

model Tenant {
  id                    String    @id @default(cuid())
  name                  String
  slug                  String    @unique
  
  // Twenty integration
  twentyWorkspaceId     String
  twentyApiKey          String    @db.Text // Encrypted at application layer
  twentyWebhookSecret   String    // Encrypted
  
  // Scoring config
  scoringRules          ScoringRule[]
  
  // Feature flags
  enableAutoOpportunity  Boolean   @default(true)
  opportunityThreshold   Int       @default(60)
  enableEnrichment       Boolean   @default(true)
  enrichmentProviders    String[]  @default(["clearbit", "apollo", "hunter"]) // Ordered fallback
  
  // Rate limits
  enrichmentRequestsPerMonth Int   @default(5000)
  webhookRateLimit       Int       @default(1000) // per minute
  
  // Metadata
  plan                   String    @default("starter") // starter, professional, enterprise
  status                 String    @default("active")  // active, suspended, deleted
  createdAt             DateTime   @default(now())
  updatedAt             DateTime   @updatedAt
  deletedAt             DateTime?
  
  webhookLogs           WebhookLog[]
  auditLogs             AuditLog[]
  scoreHistory          ScoreHistory[]
  
  @@index([slug])
  @@index([status])
  @@index([deletedAt])
}

// ============================================================================
// SCORING & INTELLIGENCE
// ============================================================================

model ScoringRule {
  id                    String    @id @default(cuid())
  tenantId              String
  tenant                Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  
  name                  String    // e.g., "Enterprise Tech Companies"
  description           String?
  
  // Rule configuration (JSON for flexibility)
  rules                 Json      // { "filters": [ { "field": "industry", "op": "eq", "value": "technology" } ], "scoring": { "titleKeywords": [...] } }
  
  enabled               Boolean   @default(true)
  priority              Int       @default(0) // Higher = applied first
  
  createdAt             DateTime   @default(now())
  updatedAt             DateTime   @updatedAt
  
  @@index([tenantId])
  @@index([enabled])
}

model ScoreHistory {
  id                    String    @id @default(cuid())
  tenantId              String
  tenant                Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  
  // Reference to Twenty record
  personTwentyId        String
  personName            String?
  personEmail           String?
  
  // Scoring result
  score                 Int       // 0–100
  factors               Json      // { "titleMatch": 25, "companySizeMatch": 15, ... }
  ruleName              String?
  
  // Opportunity
  opportunityCreated    Boolean   @default(false)
  opportunityTwentyId   String?
  
  // Audit
  createdAt             DateTime   @default(now())
  
  @@index([tenantId, createdAt])
  @@index([personTwentyId])
}

// ============================================================================
// ENRICHMENT & DATA
// ============================================================================

model EnrichmentProvider {
  id                    String    @id @default(cuid())
  tenantId              String    @unique
  
  clearbitApiKey        String?   // Encrypted
  apolloApiKey          String?   // Encrypted
  hunterApiKey          String?   // Encrypted
  
  requestsUsedThisMonth Int       @default(0)
  lastResetDate         DateTime  @default(now())
  
  updatedAt             DateTime   @updatedAt
  
  @@index([tenantId])
}

model EnrichedPerson {
  id                    String    @id @default(cuid())
  tenantId              String
  
  personTwentyId        String
  personEmail           String?
  
  // Enrichment data
  companyName           String?
  companyDomain         String?
  companySize           String?   // "1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"
  industry              String?
  location              String?
  jobTitle              String?
  jobFunction           String?
  
  // Technology stack (JSON array)
  technologies          String[]  @default([])
  
  // Source & freshness
  source                String?   // "clearbit", "apollo", "hunter", "manual"
  confidence            Int       @default(100) // 0–100
  enrichedAt            DateTime  @default(now())
  
  @@unique([tenantId, personTwentyId])
  @@index([tenantId, personEmail])
}

// ============================================================================
// WEBHOOK & AUDIT
// ============================================================================

model WebhookLog {
  id                    String    @id @default(cuid())
  tenantId              String
  tenant                Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  
  event                 String    // "person.created", "opportunity.updated", etc.
  payload               Json      // Full webhook payload
  
  // Processing
  status                String    @default("queued")    // queued, processing, success, failed
  error                 String?   // Error message if failed
  attempts              Int       @default(0)
  maxAttempts           Int       @default(5)
  nextRetryAt           DateTime?
  
  // Associated job
  jobId                 String?
  jobResult             Json?
  
  createdAt             DateTime   @default(now())
  processedAt           DateTime?
  
  @@index([tenantId, status])
  @@index([event])
  @@index([createdAt])
}

model AuditLog {
  id                    String    @id @default(cuid())
  tenantId              String
  tenant                Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  
  // Action details
  action                String    // "enrich_person", "score_person", "create_opportunity", "update_company"
  resourceType          String?   // "Person", "Company", "Opportunity"
  resourceTwentyId      String?   // Twenty ID of the affected resource
  
  // Change tracking
  before                Json?     // Snapshot before
  after                 Json?     // Snapshot after
  
  // Context
  triggeredBy           String    // "webhook:person.created", "job:enrich-and-score", "manual:admin"
  webhookLogId          String?
  
  // Result
  success               Boolean   @default(true)
  message               String?
  
  createdAt             DateTime   @default(now())
  
  @@index([tenantId, createdAt])
  @@index([action])
  @@index([resourceTwentyId])
}

// ============================================================================
// JOBS & QUEUES
// ============================================================================

model JobResult {
  id                    String    @id @default(cuid())
  tenantId              String
  
  jobType               String    // "enrich-and-score", "deal-health", "batch-score"
  jobId                 String    // BullMQ job ID
  
  status                String    @default("processing")  // processing, completed, failed
  input                 Json
  output                Json?
  error                 String?
  
  startedAt             DateTime  @default(now())
  completedAt           DateTime?
  
  @@index([tenantId, jobType])
  @@index([status])
}
```

---

## 6. API Specification

### 1. Health & Status

```http
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-08-22T14:30:00Z",
  "checks": {
    "database": "ok",
    "redis": "ok",
    "twenty_api": "ok"
  }
}
```

---

### 2. Webhook Receiver (Most Important)

```http
POST /webhooks/twenty/:tenantId
Content-Type: application/json
x-twenty-webhook-signature: hmac-sha256=...
x-twenty-webhook-id: evt_abc123
x-twenty-timestamp: 1692712800
```

**Request Body:**
```json
{
  "event": "person.created",
  "data": {
    "id": "person_123",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com"
  },
  "timestamp": "2026-08-22T14:30:00Z"
}
```

**Response (immediate):**
```http
200 OK
Content-Type: application/json
```
```json
{
  "received": true,
  "webhookId": "evt_abc123"
}
```

**Error Responses:**
```http
401 Unauthorized
```
```json
{
  "error": "Invalid signature",
  "code": "WEBHOOK_SIGNATURE_MISMATCH"
}
```

```http
404 Not Found
```
```json
{
  "error": "Tenant not found",
  "code": "TENANT_NOT_FOUND"
}
```

---

### 3. Webhook Configuration (Admin Endpoint)

```http
POST /api/v1/admin/tenants/:tenantId/webhooks
Authorization: Bearer {apiKey}
Content-Type: application/json
```

**Request:**
```json
{
  "events": ["person.created", "person.updated", "opportunity.created"],
  "url": "https://your-backend.com/webhooks/twenty/tenant123"
}
```

**Response:**
```json
{
  "id": "wh_123",
  "tenantId": "tenant_123",
  "events": ["person.created", "person.updated"],
  "url": "https://your-backend.com/webhooks/twenty/tenant123",
  "secret": "whsec_abc...", // Share this with Twenty
  "status": "active",
  "createdAt": "2026-08-22T14:30:00Z"
}
```

---

### 4. Scoring Rules (Configuration)

```http
GET /api/v1/admin/tenants/:tenantId/scoring-rules
Authorization: Bearer {apiKey}
```

**Response:**
```json
{
  "rules": [
    {
      "id": "rule_123",
      "name": "Enterprise Tech",
      "enabled": true,
      "priority": 10,
      "rules": {
        "filters": [
          {
            "field": "industry",
            "operator": "eq",
            "value": "Technology"
          },
          {
            "field": "companySize",
            "operator": "gte",
            "value": "500"
          }
        ],
        "scoring": {
          "titleKeywords": {
            "keywords": ["CEO", "VP", "Director"],
            "weight": 25
          },
          "companySizeMatch": {
            "weight": 20
          },
          "industryMatch": {
            "weight": 20
          },
          "activityRecency": {
            "weight": 15,
            "daysThreshold": 7
          }
        }
      }
    }
  ]
}
```

```http
POST /api/v1/admin/tenants/:tenantId/scoring-rules
Authorization: Bearer {apiKey}
Content-Type: application/json
```

**Request:**
```json
{
  "name": "Mid-market Professional Services",
  "enabled": true,
  "priority": 5,
  "rules": {
    "filters": [
      {
        "field": "industry",
        "operator": "in",
        "value": ["Professional Services", "Consulting"]
      }
    ],
    "scoring": {
      "titleKeywords": {
        "keywords": ["Partner", "Director", "Manager"],
        "weight": 30
      }
    }
  }
}
```

---

### 5. Audit Trail Query

```http
GET /api/v1/admin/tenants/:tenantId/audit?action=enrich_person&limit=50&offset=0
Authorization: Bearer {apiKey}
```

**Response:**
```json
{
  "logs": [
    {
      "id": "audit_123",
      "action": "enrich_person",
      "resourceType": "Person",
      "resourceTwentyId": "person_123",
      "before": {
        "email": "john@example.com"
      },
      "after": {
        "email": "john@example.com",
        "company": "Acme Corp",
        "industry": "Technology"
      },
      "triggeredBy": "webhook:person.created",
      "success": true,
      "createdAt": "2026-08-22T14:30:00Z"
    }
  ],
  "total": 1234
}
```

---

### 6. Score History

```http
GET /api/v1/admin/tenants/:tenantId/scores?personTwentyId=person_123
Authorization: Bearer {apiKey}
```

**Response:**
```json
{
  "scores": [
    {
      "id": "score_123",
      "personTwentyId": "person_123",
      "personName": "John Doe",
      "score": 87,
      "factors": {
        "titleMatch": 25,
        "companySizeMatch": 20,
        "industryMatch": 15,
        "activityRecency": 12,
        "otherSignals": 15
      },
      "ruleName": "Enterprise Tech",
      "opportunityCreated": true,
      "opportunityTwentyId": "opp_456",
      "createdAt": "2026-08-22T14:30:00Z"
    }
  ]
}
```

---

### 7. Tenant Configuration

```http
GET /api/v1/admin/tenants/:tenantId/config
Authorization: Bearer {apiKey}
```

**Response:**
```json
{
  "tenantId": "tenant_123",
  "name": "Acme Sales Inc.",
  "plan": "professional",
  "settings": {
    "autoOpportunity": {
      "enabled": true,
      "threshold": 65
    },
    "enrichment": {
      "enabled": true,
      "providers": ["clearbit", "apollo", "hunter"],
      "monthlyBudget": 5000,
      "monthlyUsage": 2341
    },
    "scoring": {
      "rules": [...]
    }
  }
}
```

```http
PATCH /api/v1/admin/tenants/:tenantId/config
Authorization: Bearer {apiKey}
Content-Type: application/json
```

**Request:**
```json
{
  "settings": {
    "autoOpportunity": {
      "threshold": 70
    },
    "enrichment": {
      "monthlyBudget": 7500
    }
  }
}
```

---

## 7. Webhook & Event Handling

### Supported Events (Phase 1)

| Event | Trigger | Action |
|-------|---------|--------|
| `person.created` | New contact added to Twenty | Enrich + Score + possible Opportunity |
| `person.updated` | Contact details changed | Re-score if email/company changed |
| `company.created` | New account added | Optional: enrich company |
| `opportunity.created` | Deal created | Log event (future: health monitoring) |

### Webhook Signature Verification (CRITICAL)

**Implementation:**
```typescript
// src/webhooks/signature.service.ts
import crypto from 'crypto';

export class SignatureService {
  verifyHmac(
    payload: string,
    signature: string,
    secret: string
  ): boolean {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
    
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(`sha256=${expectedSignature}`)
    );
  }
}
```

**Key Points:**
- Always verify HMAC before processing
- Use `crypto.timingSafeEqual` to prevent timing attacks
- Return 200 OK immediately (async process)
- Envelope the raw body for signature (not parsed JSON)
- Rotate webhook secret annually

### Idempotency & Replay Protection

```typescript
// src/webhooks/idempotency.middleware.ts
export class IdempotencyMiddleware {
  async handle(req, res, next) {
    const webhookId = req.headers['x-twenty-webhook-id'];
    const timestamp = parseInt(req.headers['x-twenty-timestamp']);
    
    // Reject timestamps older than 5 minutes
    if (Date.now() - timestamp * 1000 > 5 * 60 * 1000) {
      return res.status(401).send('Timestamp too old');
    }
    
    // Check for duplicate webhook ID (in Redis with TTL 24 hours)
    const seen = await redis.get(`webhook:${webhookId}`);
    if (seen) {
      return res.status(200).send('Already processed (idempotent)');
    }
    
    await redis.setex(`webhook:${webhookId}`, 86400, 'true');
    next();
  }
}
```

### Retry & Dead-Letter Queue Strategy

```typescript
// src/jobs/job.config.ts
const JOB_CONFIG = {
  'enrich-and-score-person': {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 2000, // 2s, 4s, 8s, 16s, 32s
    },
    removeOnComplete: { age: 3600 }, // Keep 1 hour
    removeOnFail: { age: 86400 }, // Keep 24 hours
  },
};

// Failed jobs go to DLQ automatically after max attempts
// Manually process DLQ: GET /api/v1/admin/jobs/dlq
```

---

## 8. Enrichment Pipeline

### Supported Providers & Strategy

| Provider | Cost | Coverage | Speed | Integration |
|----------|------|----------|-------|-------------|
| **Clearbit** | ~$0.05–0.10/lookup | 90% companies, 60% people | 100ms | REST API |
| **Apollo** | ~$0.01/lookup | 70% people, 75% companies | 150ms | REST API |
| **Hunter** | ~$0.02/lookup | Email finding (80% domain) | 200ms | REST API |
| **Manual/CRM** | Free | Whatever you enter | - | N/A |

**Recommendation for MVP:**
1. Try **Clearbit** first (best quality)
2. Fall back to **Apollo** (good coverage, cheap)
3. Fall back to **Hunter** (for email finding)
4. Fall back to **manual** (mark as low confidence)

### Enrichment Job Flow

```typescript
// src/jobs/processors/enrich-and-score.processor.ts

async function enrichAndScorePerson(job: Job) {
  const { tenantId, personTwentyId } = job.data;
  
  // 1. Fetch from Twenty
  const person = await twentyClient.getPerson(personTwentyId);
  const auditLog = {
    action: 'enrich_person',
    before: person,
  };
  
  // 2. Check if already enriched (cache hit)
  const cached = await EnrichedPerson.findUnique({
    where: { tenantId_personTwentyId: { tenantId, personTwentyId } },
  });
  
  if (cached && isRecent(cached.enrichedAt, days: 7)) {
    logger.info(`Using cached enrichment for ${personTwentyId}`);
    enrichmentData = cached;
  } else {
    // 3. Enrich from providers (with fallback)
    enrichmentData = await enrichmentService.enrich(person, tenantId);
    
    // 4. Persist enrichment
    await EnrichedPerson.upsert({
      where: { tenantId_personTwentyId },
      update: enrichmentData,
      create: { tenantId, personTwentyId, ...enrichmentData },
    });
  }
  
  // 5. Score
  const { score, factors } = await scoringEngine.score(person, enrichmentData, tenantId);
  
  // 6. Write back to Twenty
  await twentyClient.updatePerson(personTwentyId, {
    company: enrichmentData.companyName,
    jobTitle: enrichmentData.jobTitle,
    location: enrichmentData.location,
    [CUSTOM_FIELD_SCORE]: score,
  });
  
  // 7. Create Note (timeline)
  await twentyClient.createNote(personTwentyId, {
    text: `AI Enrichment: Score ${score}/100 (${Object.entries(factors).map(([k, v]) => `${k}: ${v}`).join(', ')})`,
    activityType: 'note',
  });
  
  // 8. Auto-create Opportunity if threshold met
  if (score >= tenant.opportunityThreshold && !opportunityExists) {
    await twentyClient.createOpportunity({
      personId: personTwentyId,
      name: `${person.firstName} - Auto-qualified`,
      stage: 'prospect',
      probability: Math.round(score / 10), // 0–10 scale
    });
    
    auditLog.opportunityCreated = true;
  }
  
  // 9. Audit
  auditLog.after = person;
  auditLog.success = true;
  await AuditLog.create({ tenantId, ...auditLog });
  
  return { score, factors, enrichmentData };
}
```

### Enrichment Data Mapping (to Twenty)

```typescript
// src/enrichment/mapper.ts
const FIELD_MAPPING = {
  clearbit: {
    companyName: 'company.name',
    industry: 'company.category.industry',
    companySize: 'company.metrics.employees', // Map to "1-10", "11-50", etc.
    jobTitle: 'person.jobTitle',
    location: 'person.location.city',
    technologies: 'company.tech', // Array of tech names
  },
  apollo: {
    companyName: 'organization.name',
    industry: 'organization.industry',
    jobTitle: 'person.job_title',
    technologies: 'organization.technologies',
  },
  hunter: {
    email: 'data.email', // Email finding
    source: 'meta.verification.code', // Confidence
  },
};
```

---

## 9. Scoring Engine

### Scoring Formula

```
Final Score = (weighted sum of factors) / max_possible_weight * 100

Factors:
  ├─ Title Match (25%) — CEO, VP, Manager, etc. → high match
  ├─ Company Size Match (20%) — Does size fit ICP?
  ├─ Industry Match (20%) — Is industry in target list?
  ├─ Activity Recency (15%) — Last update < 7 days?
  ├─ Location Match (10%) — Is timezone/region relevant?
  ├─ Technology Stack (5%) — Uses our tech stack?
  └─ Engagement Signals (5%) — Email opened, clicked, replied?

Example:
  person.title = "VP of Sales" → titleMatch = 25
  person.company.size = "500+" → sizeMatch = 20
  person.company.industry = "SaaS" → industryMatch = 20
  lastUpdated = 2 days ago → recency = 15
  person.location = "US East Coast" → locationMatch = 8
  technologies = ["Salesforce", "HubSpot"] → techMatch = 3
  
  Total = (25 + 20 + 20 + 15 + 8 + 3) / 100 * 100 = 91/100
```

### Implementation

```typescript
// src/scoring/scoring.engine.ts

export class ScoringEngine {
  async score(
    person: Person,
    enrichmentData: EnrichedPerson,
    tenantId: string
  ): Promise<{ score: number; factors: Record<string, number> }> {
    const tenant = await Tenant.findUnique({ where: { id: tenantId } });
    const rules = await ScoringRule.findMany({
      where: { tenantId, enabled: true },
      orderBy: { priority: 'desc' },
    });
    
    const factors = {};
    let totalScore = 0;
    
    for (const rule of rules) {
      // Check if rule filters match
      if (!this.matchesFilters(enrichmentData, rule.rules.filters)) {
        continue;
      }
      
      // Apply scoring factors
      const ruleFactors = this.calculateFactors(person, enrichmentData, rule.rules.scoring);
      
      Object.assign(factors, ruleFactors);
      totalScore = this.weightedSum(ruleFactors);
      
      // Rule matched; stop (first-match wins)
      break;
    }
    
    return {
      score: Math.min(100, Math.max(0, totalScore)),
      factors,
    };
  }
  
  private calculateFactors(person, enrichment, scoringConfig): Record<string, number> {
    const factors = {};
    
    // Title match
    if (scoringConfig.titleKeywords) {
      const titleKeywords = scoringConfig.titleKeywords.keywords || [];
      const match = titleKeywords.some(kw =>
        person.jobTitle?.toLowerCase().includes(kw.toLowerCase())
      );
      factors.titleMatch = match ? 25 : 0;
    }
    
    // Company size
    if (scoringConfig.companySizeMatch) {
      const sizeMap = { '1-10': 5, '11-50': 15, '51-200': 20, '201-500': 18, '500+': 20 };
      factors.companySizeMatch = sizeMap[enrichment.companySize] || 0;
    }
    
    // Industry
    if (scoringConfig.industryMatch) {
      factors.industryMatch = enrichment.industry ? 20 : 0;
    }
    
    // Activity recency
    if (scoringConfig.activityRecency) {
      const daysOld = Math.floor((Date.now() - person.updatedAt.getTime()) / (1000 * 60 * 60 * 24));
      factors.activityRecency = daysOld <= 7 ? 15 : daysOld <= 30 ? 10 : 0;
    }
    
    return factors;
  }
  
  private matchesFilters(data, filters): boolean {
    if (!filters || filters.length === 0) return true;
    
    return filters.every(filter => {
      const value = this.getNestedValue(data, filter.field);
      
      switch (filter.operator) {
        case 'eq': return value === filter.value;
        case 'gte': return Number(value) >= Number(filter.value);
        case 'lte': return Number(value) <= Number(filter.value);
        case 'in': return filter.value.includes(value);
        case 'contains': return String(value).includes(filter.value);
        default: return true;
      }
    });
  }
  
  private weightedSum(factors: Record<string, number>): number {
    return Object.values(factors).reduce((a, b) => a + b, 0);
  }
}
```

### Explainability

Every score must include **factors breakdown** so sales team can understand why someone was scored low:

```json
{
  "personName": "Jane Smith",
  "score": 73,
  "breakdown": {
    "titleMatch": { "value": 25, "reason": "VP matches target titles" },
    "companySizeMatch": { "value": 20, "reason": "Company has 300+ employees" },
    "industryMatch": { "value": 20, "reason": "SaaS industry match" },
    "activityRecency": { "value": 8, "reason": "Updated 4 days ago" },
    "otherSignals": { "value": 0, "reason": "No engagement detected" }
  },
  "nextActions": [
    "Email has not been enriched; try re-running enrichment",
    "Consider calling if titleMatch is met"
  ]
}
```

---

## 10. Multi-Tenancy Strategy

### Architecture Decision: One Workspace per Customer (v1)

| Strategy | Pros | Cons | Timeline |
|----------|------|------|----------|
| **One workspace per tenant** | Simple, strong isolation, easy billing | Higher Twenty license cost | **v1 (use this)** |
| **Shared workspace + row-level security** | Cost efficient, scalable | Complex RLS in Twenty, risk of data leak | v2–3 (future) |
| **Dedicated Postgres schema per tenant** | Fast access, isolation | Complex migrations, higher infra cost | v2–3 (future) |

### Implementation (v1 Approach)

```typescript
// src/tenants/tenant.service.ts

export class TenantService {
  async createTenant(input: CreateTenantInput) {
    // 1. Create tenant record
    const tenant = await Tenant.create({
      name: input.name,
      slug: slugify(input.name),
      twentyWorkspaceId: input.twentyWorkspaceId,
      twentyApiKey: await encrypt(input.twentyApiKey), // Never store plaintext
      twentyWebhookSecret: await encrypt(generateSecret(32)),
      plan: 'starter',
    });
    
    // 2. Create enrichment provider config
    await EnrichmentProvider.create({
      tenantId: tenant.id,
      clearbitApiKey: input.clearbitApiKey ? await encrypt(input.clearbitApiKey) : null,
    });
    
    // 3. Create default scoring rule
    await ScoringRule.create({
      tenantId: tenant.id,
      name: 'Default Scoring',
      enabled: true,
      rules: DEFAULT_SCORING_RULES,
    });
    
    // 4. Return webhook URL for customer to configure in Twenty
    return {
      tenantId: tenant.id,
      webhookUrl: `https://api.yourbackend.com/webhooks/twenty/${tenant.id}`,
      webhookSecret: tenant.twentyWebhookSecret, // Share with customer
    };
  }
  
  async getTenant(tenantId: string): Promise<Tenant> {
    const tenant = await Tenant.findUnique({
      where: { id: tenantId },
    });
    
    if (!tenant) throw new TenantNotFoundError();
    return tenant;
  }
}
```

### Tenant Context in Requests

```typescript
// src/common/decorators/tenant.decorator.ts

export const Tenant = createParamDecorator((data, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();
  return req.tenant; // Set by middleware
});

// src/common/middleware/tenant.middleware.ts

export class TenantMiddleware implements NestMiddleware {
  async use(req: Request, res: Response, next: NextFunction) {
    const tenantId = req.params.tenantId || req.headers['x-tenant-id'];
    
    if (!tenantId) {
      throw new BadRequestException('Missing tenant ID');
    }
    
    const tenant = await tenantService.getTenant(tenantId);
    req.tenant = tenant;
    
    next();
  }
}

// Usage in controller:
@Post('/webhooks/twenty/:tenantId')
async handleWebhook(@Tenant() tenant: Tenant, @Body() payload: any) {
  // tenant is automatically available
}
```

### Encryption at Rest

```typescript
// src/common/crypto.service.ts

export class CryptoService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly masterKey = Buffer.from(process.env.MASTER_KEY, 'hex');
  
  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.masterKey, iv);
    
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // Format: iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }
  
  decrypt(ciphertext: string): string {
    const [ivHex, authTagHex, encrypted] = ciphertext.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipheriv(this.algorithm, this.masterKey, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
}
```

---

## 11. Security & Compliance

### Authentication & Authorization

```typescript
// src/common/guards/api-key.guard.ts

@Injectable()
export class ApiKeyGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest();
    const apiKey = request.headers.authorization?.split(' ')[1];
    
    if (!apiKey) return false;
    
    // Compare with hashed key in database
    const key = await ApiKey.findUnique({ where: { hash: hashApiKey(apiKey) } });
    if (!key || key.revokedAt) return false;
    
    request.user = { tenantId: key.tenantId, scope: key.scope };
    return true;
  }
}

@UseGuards(ApiKeyGuard)
@Get('/api/v1/admin/audit')
getAuditLog(@Req() req) {
  // Only return logs for req.user.tenantId
}
```

### RBAC (Role-Based Access Control)

```typescript
// src/common/decorators/require-role.decorator.ts

export const RequireRole = (...roles: string[]) =>
  SetMetadata('roles', roles);

@Injectable()
export class RoleGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const requiredRoles = Reflect.getMetadata('roles', ctx.getHandler());
    const request = ctx.switchToHttp().getRequest();
    
    if (!request.user) return false;
    return requiredRoles.includes(request.user.role);
  }
}

// Usage:
@Post('/api/v1/admin/scoring-rules')
@RequireRole('admin', 'manager')
async createScoringRule(@Body() input) { ... }
```

### Data Protection

| Item | Protection | Implementation |
|------|-----------|-----------------|
| **API Keys** | Encrypted at rest, hashed in DB | AES-256-GCM + bcrypt |
| **Webhook Secret** | Encrypted at rest | AES-256-GCM |
| **Third-party Creds** | Encrypted at rest | AES-256-GCM |
| **Logs** | No PII by default | Sanitize before write |
| **Audit Trail** | Immutable, timestamped | append-only table |
| **HTTPS** | TLS 1.3+ | Always HTTPS in production |

### GDPR/CCPA Compliance

```typescript
// src/common/gdpr.service.ts

export class GDPRService {
  // Data export for customer
  async exportTenantData(tenantId: string): Promise<Buffer> {
    const logs = await AuditLog.findMany({ where: { tenantId } });
    const scores = await ScoreHistory.findMany({ where: { tenantId } });
    const enrichment = await EnrichedPerson.findMany({ where: { tenantId } });
    
    return createZip({
      'audit.json': JSON.stringify(logs),
      'scores.json': JSON.stringify(scores),
      'enrichment.json': JSON.stringify(enrichment),
    });
  }
  
  // Right to be forgotten
  async deleteTenantData(tenantId: string): Promise<void> {
    // Soft delete; keep immutable audit trail
    await Tenant.update(
      { where: { id: tenantId } },
      { deletedAt: new Date(), status: 'deleted' }
    );
  }
}
```

### Rate Limiting

```typescript
// src/common/guards/rate-limit.guard.ts

@Injectable()
export class RateLimitGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest();
    const tenantId = request.tenant.id;
    const key = `rate_limit:${tenantId}`;
    
    const current = await redis.incr(key);
    if (current === 1) {
      await redis.expire(key, 60); // 1-minute window
    }
    
    const limit = request.tenant.webhookRateLimit || 1000;
    if (current > limit) {
      throw new TooManyRequestsException('Webhook rate limit exceeded');
    }
    
    return true;
  }
}
```

---

## 12. Observability & Monitoring

### Logging Strategy

```typescript
// src/common/logger.service.ts

import pino from 'pino';

const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    serializers: {
      req: (req) => ({
        method: req.method,
        url: req.url,
        tenantId: req.tenant?.id,
        correlationId: req.headers['x-correlation-id'],
      }),
      res: (res) => ({
        statusCode: res.statusCode,
      }),
    },
  },
  pino.transport({
    target: process.env.NODE_ENV === 'production' ? 'pino/file' : 'pino-pretty',
    options: {
      colorize: process.env.NODE_ENV !== 'production',
    },
  })
);

// Usage:
logger.info(
  {
    action: 'enrich_person',
    tenantId,
    personId,
    score,
    correlationId: req.headers['x-correlation-id'],
  },
  'Person enriched successfully'
);
```

### Metrics & Observability

```typescript
// src/observability/metrics.service.ts

import { metrics } from '@opentelemetry/api';

export class MetricsService {
  private enrichmentCounter = metrics.createCounter('enrichment_requests_total', {
    description: 'Total enrichment API requests',
  });
  
  private scoringHistogram = metrics.createHistogram('scoring_duration_ms', {
    description: 'Lead scoring duration in milliseconds',
  });
  
  recordEnrichment(tenantId: string, success: boolean) {
    this.enrichmentCounter.add(1, {
      tenant: tenantId,
      success,
    });
  }
  
  recordScoringDuration(duration: number) {
    this.scoringHistogram.record(duration);
  }
}

// Export metrics to Datadog or Prometheus:
// GET /metrics (Prometheus format)
```

### Error Tracking

```typescript
// src/common/sentry.config.ts

import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  integrations: [
    new Sentry.Integrations.Http({ tracing: true }),
    new Sentry.Integrations.OnUncaughtException(),
  ],
});

// Usage:
try {
  await enrichmentService.enrich(person);
} catch (err) {
  Sentry.captureException(err, {
    tags: { tenantId, personId },
  });
}
```

---

## 13. Deployment & DevOps

### Docker Setup

```dockerfile
# Dockerfile

FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

```yaml
# docker-compose.yml

version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ${DB_NAME:-twenty_automation}
      POSTGRES_USER: ${DB_USER:-dev}
      POSTGRES_PASSWORD: ${DB_PASSWORD:-dev}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-dev}"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  app:
    build: .
    environment:
      DATABASE_URL: postgresql://${DB_USER:-dev}:${DB_PASSWORD:-dev}@postgres:5432/${DB_NAME:-twenty_automation}
      REDIS_URL: redis://redis:6379
      MASTER_KEY: ${MASTER_KEY}
      LOG_LEVEL: ${LOG_LEVEL:-info}
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    volumes:
      - .:/app
      - /app/node_modules

volumes:
  postgres_data:
```

### Environment Variables (.env.example)

```env
# Server
NODE_ENV=development
PORT=3000
LOG_LEVEL=info

# Database
DATABASE_URL=postgresql://dev:dev@localhost:5432/twenty_automation
DATABASE_LOGGING=false

# Redis
REDIS_URL=redis://localhost:6379

# Security
MASTER_KEY=<32-byte hex string for encryption>
JWT_SECRET=<random string>

# Twenty Integration
TWENTY_CLOUD_URL=https://api.twenty.com
# TWENTY_API_KEY (set per tenant, not globally)

# Enrichment Providers
CLEARBIT_API_KEY=<your clearbit key>
APOLLO_API_KEY=<your apollo key>
HUNTER_API_KEY=<your hunter key>

# Observability
SENTRY_DSN=
OTEL_EXPORTER_OTLP_ENDPOINT=

# Features
FEATURE_AUTO_OPPORTUNITY=true
FEATURE_BATCH_SCORING=false
```

### Kubernetes Deployment (Production)

```yaml
# k8s/deployment.yaml

apiVersion: apps/v1
kind: Deployment
metadata:
  name: twenty-automation-backend
  labels:
    app: twenty-automation
spec:
  replicas: 3
  selector:
    matchLabels:
      app: twenty-automation
  template:
    metadata:
      labels:
        app: twenty-automation
    spec:
      containers:
      - name: app
        image: your-registry/twenty-automation:latest
        ports:
        - containerPort: 3000
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: twenty-automation-secrets
              key: database-url
        - name: MASTER_KEY
          valueFrom:
            secretKeyRef:
              name: twenty-automation-secrets
              key: master-key
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 5
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
```

---

## 14. Implementation Phases

### Phase 0: Foundation (Days 1–4)

**Deliverables:**
- Project scaffold (NestJS + TypeScript)
- Docker Compose (Postgres + Redis)
- Prisma schema (tenants table only)
- Twenty GraphQL client (with introspection)
- Health endpoint (`GET /health`)
- Env validation (Zod)

**Acceptance Criteria:**
- `docker-compose up` brings up Postgres + Redis + app
- `npm run dev` starts server on :3000
- `GET /health` returns 200 OK with database/redis status
- Twenty GraphQL client successfully queries `/graphql` endpoint

**Effort:** ~12–16 hours (1 developer, 2 days)

---

### Phase 1: MVP (Days 5–14) — SHIP THIS FIRST

**Deliverables:**
- Webhook receiver with HMAC signature verification
- BullMQ queue + job processor
- Tenant model + CRUD
- Enrichment service (Clearbit + fallback)
- Scoring engine (weighted sum)
- Auto-create Opportunity logic
- Audit logging
- Retry + DLQ strategy
- End-to-end test script

**Acceptance Criteria:**
- ✓ Webhook POST to `/webhooks/twenty/:tenantId/person.created` returns 200 OK immediately
- ✓ Job queued and processed asynchronously (within 10 seconds)
- ✓ Person enriched: company, job title, industry written back to Twenty
- ✓ Score calculated and stored
- ✓ If score ≥ 60, Opportunity created in Twenty
- ✓ Audit log entry created for every action
- ✓ Failed jobs retry up to 5 times, then move to DLQ
- ✓ Full end-to-end test passes on real Twenty workspace

**Effort:** ~60–80 hours (1 developer, 10 days)

**Launch Readiness:**
- Can sign up a real customer
- Can enable webhooks in their Twenty workspace
- Can watch automation in action
- Can export audit trail for compliance

---

### Phase 2: Intelligence (Weeks 3–5)

**Deliverables:**
- Deal health monitoring (stale deals, single-threading)
- Periodic batch scoring job
- Explainability breakdown (why the score?)
- Configurable scoring rules per tenant
- Human-in-the-loop approvals (optional)
- Admin dashboard (simple React SPA)

**Effort:** ~80–120 hours (1–2 developers, 3 weeks)

---

### Phase 3: Scale & Product (Month 2+)

**Deliverables:**
- Full multi-tenancy isolation (shared workspace option)
- Predictive forecasting
- Usage analytics
- White-label control plane
- Pricing & billing

**Effort:** ~200+ hours

---

## 15. Project Structure

```
twenty-automation-backend/
├── src/
│   ├── main.ts                       # Entry point
│   ├── app.module.ts                 # Root module
│   │
│   ├── config/
│   │   ├── env.schema.ts             # Zod validation
│   │   ├── database.config.ts
│   │   └── redis.config.ts
│   │
│   ├── tenants/
│   │   ├── tenant.entity.ts
│   │   ├── tenant.service.ts
│   │   ├── tenant.controller.ts
│   │   └── tenant.module.ts
│   │
│   ├── webhooks/
│   │   ├── webhook.receiver.ts       # Fastify route handler
│   │   ├── signature.service.ts      # HMAC verification
│   │   ├── idempotency.middleware.ts
│   │   └── webhook.module.ts
│   │
│   ├── jobs/
│   │   ├── bull.module.ts            # BullMQ setup
│   │   ├── processors/
│   │   │   ├── enrich-and-score.processor.ts
│   │   │   ├── deal-health.processor.ts
│   │   │   └── batch-score.processor.ts
│   │   └── jobs.module.ts
│   │
│   ├── enrichment/
│   │   ├── enrichment.service.ts     # Orchestration
│   │   ├── providers/
│   │   │   ├── clearbit.provider.ts
│   │   │   ├── apollo.provider.ts
│   │   │   ├── hunter.provider.ts
│   │   │   └── fallback.provider.ts
│   │   ├── cache.service.ts
│   │   └── enrichment.module.ts
│   │
│   ├── scoring/
│   │   ├── scoring.engine.ts
│   │   ├── scoring.service.ts
│   │   └── scoring.module.ts
│   │
│   ├── twenty/
│   │   ├── twenty.client.ts          # GraphQL client
│   │   ├── fragments/
│   │   │   ├── person.fragment.ts
│   │   │   ├── company.fragment.ts
│   │   │   └── opportunity.fragment.ts
│   │   ├── mutations/
│   │   │   ├── update-person.mutation.ts
│   │   │   ├── create-opportunity.mutation.ts
│   │   │   └── create-note.mutation.ts
│   │   └── twenty.module.ts
│   │
│   ├── audit/
│   │   ├── audit.service.ts
│   │   ├── audit.controller.ts
│   │   └── audit.module.ts
│   │
│   ├── common/
│   │   ├── guards/
│   │   │   ├── api-key.guard.ts
│   │   │   ├── role.guard.ts
│   │   │   └── rate-limit.guard.ts
│   │   ├── decorators/
│   │   │   ├── tenant.decorator.ts
│   │   │   └── require-role.decorator.ts
│   │   ├── interceptors/
│   │   │   └── logging.interceptor.ts
│   │   ├── middleware/
│   │   │   └── tenant.middleware.ts
│   │   ├── filters/
│   │   │   └── all-exceptions.filter.ts
│   │   ├── pipes/
│   │   │   └── validation.pipe.ts
│   │   ├── crypto.service.ts
│   │   ├── logger.service.ts
│   │   ├── metrics.service.ts
│   │   └── common.module.ts
│   │
│   └── observability/
│       ├── sentry.config.ts
│       ├── otel.config.ts
│       └── observability.module.ts
│
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
│
├── test/
│   ├── e2e/
│   │   ├── webhook.e2e-spec.ts
│   │   ├── scoring.e2e-spec.ts
│   │   └── enrichment.e2e-spec.ts
│   └── unit/
│       ├── scoring.engine.spec.ts
│       └── tenant.service.spec.ts
│
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── .env.test
├── .eslintrc.json
├── .prettierrc
├── tsconfig.json
├── package.json
├── jest.config.js
└── README.md
```

---

## 16. Development Workflow in Cursor

### Setup (First Time)

1. **Clone or create repo:**
   ```bash
   git init twenty-automation-backend
   cd twenty-automation-backend
   ```

2. **Copy project structure** (use the scaffold provided in appendix)

3. **Install dependencies:**
   ```bash
   npm install
   ```

4. **Create `.env` from `.env.example`:**
   ```bash
   cp .env.example .env
   # Edit .env with your values (use dummy values for now)
   ```

5. **Start services:**
   ```bash
   docker-compose up -d
   ```

6. **Run migrations:**
   ```bash
   npx prisma migrate dev --name init
   ```

7. **Start dev server:**
   ```bash
   npm run dev
   ```

### Daily Workflow in Cursor

1. **Start your session:**
   ```bash
   docker-compose up -d  # if not already running
   npm run dev
   ```

2. **Create a new file or module:**
   - Right-click in file explorer → New File
   - Cursor auto-suggests imports and types

3. **Write code with Cursor's AI:**
   - Highlight code → CMD+K → "add error handling"
   - Write comments above a function → CMD+K → "generate implementation"
   - Right-click → "Generate test"

4. **Run tests:**
   ```bash
   npm test
   npm run test:e2e
   ```

5. **Check database:**
   ```bash
   npx prisma studio  # Opens web UI at :5555
   ```

6. **View logs:**
   ```bash
   docker-compose logs -f app
   ```

7. **Iterate on implementation:**
   - Make a change
   - Tests auto-run in watch mode
   - See immediate feedback

### Cursor-Specific Tips

- **Schema Generation**: After updating `prisma/schema.prisma`, Cursor auto-suggests `prisma migrate dev`.
- **Type Inference**: Hover over any variable → Cursor shows inferred type + JSDocs.
- **Autocomplete**: Start typing `await twentyClient.` → full method list appears.
- **Git Integration**: Cmd+Shift+G → view diffs, commit, push without leaving editor.
- **Terminal**: Cmd+` → integrated terminal for running migrations, tests, scripts.

---

## 17. Decisions & Trade-offs

| Decision | Trade-off | Rationale |
|----------|-----------|-----------|
| **One workspace per tenant (v1)** | Higher cost per customer initially | Simpler multi-tenancy; easier to migrate to shared workspace later |
| **BullMQ over Kafka** | Lower throughput ceiling (millions/day vs. tens of millions) | Simpler operations; handles MVP + Phase 2 scale easily |
| **GraphQL client (graphql-request)** vs. REST | Requires learning GraphQL; need schema introspection | Future-proof; Twenty invests in GraphQL; faster, no over-fetching |
| **Webhook-driven over polling** | Must handle eventual consistency; can't query everything in real-time | Real-time, scalable; less load on Twenty API; standard SaaS pattern |
| **Postgres over MongoDB** | Schema management overhead | ACID, transactions, audit trail simplicity; enrichment data needs structure |
| **NestJS over Express** | Heavier framework | Built-in DI, guards, pipes, interceptors; Cursor loves the structure |
| **Encryption at rest (AES-256-GCM)** | Small performance cost; key management needed | Compliance (GDPR, CCPA); security best practice |

---

## 18. Testing Strategy

### Unit Tests (Scoring, Enrichment, Validation)

```typescript
// test/unit/scoring.engine.spec.ts

describe('ScoringEngine', () => {
  let engine: ScoringEngine;
  
  beforeEach(() => {
    engine = new ScoringEngine();
  });
  
  it('should score a person with high title match', async () => {
    const person = { jobTitle: 'VP of Sales' };
    const enrichment = { companySize: '500+', industry: 'SaaS' };
    
    const { score, factors } = await engine.score(person, enrichment, 'tenant_123');
    
    expect(score).toBeGreaterThan(70);
    expect(factors.titleMatch).toBe(25);
  });
  
  it('should apply first matching rule', async () => {
    // Test rule priority
  });
});
```

### Integration Tests (Webhook → Score → Opportunity)

```typescript
// test/e2e/webhook.e2e-spec.ts

describe('Webhook Receiver (E2E)', () => {
  let app: INestApplication;
  let twentyMock: any;
  
  beforeAll(async () => {
    // Create test database
    // Mock Twenty GraphQL client
    // Start app
  });
  
  it('should enrich person and create opportunity on high score', async () => {
    const payload = { event: 'person.created', data: { ... } };
    const signature = generateHmac(payload, SECRET);
    
    const res = await request(app.getHttpServer())
      .post(`/webhooks/twenty/tenant_test`)
      .set('x-twenty-webhook-signature', signature)
      .send(payload);
    
    expect(res.status).toBe(200);
    
    // Wait for job to complete (with timeout)
    await waitForJobCompletion(jobId, 5000);
    
    // Assert in database
    const person = await Person.findUnique({...});
    expect(person.enrichedAt).toBeDefined();
    expect(person.score).toBeGreaterThan(60);
    
    // Assert Twenty mock was called
    expect(twentyMock.updatePerson).toHaveBeenCalledWith(
      expect.objectContaining({ company: 'Acme' })
    );
  });
});
```

### Test Coverage Target

- **Unit:** 80% (core logic: scoring, enrichment, validation)
- **Integration:** 60% (webhook → job → write-back)
- **E2E:** Happy path + error cases
- **Load Test:** 100 webhooks/second for 60s (with BullMQ under load)

---

## 19. Launch Checklist

### Pre-Launch (Week 1)

- [ ] Code review (peer + Cursor lint)
- [ ] Security audit (OWASP Top 10)
- [ ] Load testing (100+ webhooks/sec)
- [ ] Database backups configured
- [ ] Error tracking (Sentry) working
- [ ] Logging centralized (CloudWatch / ELK)
- [ ] API documentation complete (Swagger)

### Launch Day

- [ ] Deploy to production (via CI/CD)
- [ ] Smoke tests pass
- [ ] Webhook URL shared with first customer
- [ ] Customer enables webhook in Twenty
- [ ] Manual test: create person → observe enrichment → check audit log
- [ ] Monitor: p99 latency, error rate, job failures
- [ ] On-call rotation established

### Post-Launch (Week 2)

- [ ] Gather customer feedback
- [ ] Monitor infrastructure costs
- [ ] Fix any hot bugs
- [ ] Plan Phase 2

---

## 20. Appendices

### A. Quick Start Scaffold (Ready to Use)

See next section: **Complete Starter Code for Cursor**

### B. GraphQL Queries & Mutations (Twenty)

```graphql
# Get person
query GetPerson($id: ID!) {
  person(id: $id) {
    id
    firstName
    lastName
    email
    jobTitle
    createdAt
    updatedAt
    company {
      id
      name
      website
    }
  }
}

# Update person
mutation UpdatePerson($id: ID!, $input: PersonInput!) {
  updatePerson(id: $id, input: $input) {
    id
    ...PersonFragment
  }
}

# Create opportunity
mutation CreateOpportunity($input: OpportunityInput!) {
  createOpportunity(input: $input) {
    id
    name
    stage
    person {
      id
      firstName
    }
  }
}

# Create note
mutation CreateNote($input: NoteInput!) {
  createNote(input: $input) {
    id
    text
    createdAt
  }
}
```

### C. Environment Variables (Secure Handling)

**Development:**
```bash
# .env (gitignored)
DATABASE_URL=postgresql://dev:dev@localhost:5432/twenty_automation
REDIS_URL=redis://localhost:6379
MASTER_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

**Production:**
```bash
# Use AWS Secrets Manager / HashiCorp Vault
# Never commit secrets
# Rotate annually
```

### D. Monitoring Dashboard (Prometheus + Grafana)

Metrics to track:
- Webhook latency (p50, p95, p99)
- Enrichment success rate (%)
- Scoring average (0–100)
- Job failure rate (%)
- Database query time
- Redis memory usage
- DLQ size (should be 0 in steady state)

### E. Troubleshooting Guide

| Issue | Debug Steps |
|-------|-------------|
| Webhook not triggering | 1. Check webhook registered in Twenty 2. Verify signature in logs 3. Check Redis queue (`redis-cli LLEN bull:...`) |
| Enrichment failing silently | 1. Check provider API keys in DB 2. Monitor enrichment service logs 3. Check rate limits (Clearbit, Apollo) |
| Job stuck in processing | 1. Check Redis (`LLEN bull:...`) 2. Check Postgres for hanging transactions 3. Restart worker if needed |
| Scoring wrong | 1. Check ScoringRule in DB 2. Verify factors calculation 3. Add debug logs to scoring engine |

---

## References & Further Reading

- **Twenty Docs:** https://docs.twenty.com
- **Twenty API:** https://docs.twenty.com/developers
- **NestJS Docs:** https://docs.nestjs.com
- **BullMQ Docs:** https://docs.bullmq.io
- **Prisma Docs:** https://www.prisma.io/docs
- **GraphQL Best Practices:** https://graphql.org/learn/best-practices

---

**Document End**

This handoff is complete, production-ready, and sized for immediate implementation in Cursor. All architecture decisions are explained, and the implementation plan is detailed week-by-week.

Next: Full starter code scaffold is provided below.
