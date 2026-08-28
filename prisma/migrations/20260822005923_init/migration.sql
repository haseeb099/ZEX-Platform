-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "twentyWorkspaceId" TEXT NOT NULL,
    "twentyApiKey" TEXT NOT NULL,
    "twentyWebhookSecret" TEXT NOT NULL,
    "enableAutoOpportunity" BOOLEAN NOT NULL DEFAULT true,
    "opportunityThreshold" INTEGER NOT NULL DEFAULT 60,
    "enableEnrichment" BOOLEAN NOT NULL DEFAULT true,
    "enrichmentProviders" TEXT[] DEFAULT ARRAY['clearbit', 'apollo', 'hunter']::TEXT[],
    "enrichmentRequestsPerMonth" INTEGER NOT NULL DEFAULT 5000,
    "webhookRateLimit" INTEGER NOT NULL DEFAULT 1000,
    "plan" TEXT NOT NULL DEFAULT 'starter',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoringRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rules" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScoringRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreHistory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "personTwentyId" TEXT NOT NULL,
    "personName" TEXT,
    "personEmail" TEXT,
    "score" INTEGER NOT NULL,
    "factors" JSONB NOT NULL,
    "ruleName" TEXT,
    "opportunityCreated" BOOLEAN NOT NULL DEFAULT false,
    "opportunityTwentyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrichmentProvider" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clearbitApiKey" TEXT,
    "apolloApiKey" TEXT,
    "hunterApiKey" TEXT,
    "requestsUsedThisMonth" INTEGER NOT NULL DEFAULT 0,
    "lastResetDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnrichmentProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrichedPerson" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "personTwentyId" TEXT NOT NULL,
    "personEmail" TEXT,
    "companyName" TEXT,
    "companyDomain" TEXT,
    "companySize" TEXT,
    "industry" TEXT,
    "location" TEXT,
    "jobTitle" TEXT,
    "jobFunction" TEXT,
    "technologies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" TEXT,
    "confidence" INTEGER NOT NULL DEFAULT 100,
    "enrichedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnrichedPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextRetryAt" TIMESTAMP(3),
    "jobId" TEXT,
    "jobResult" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT,
    "resourceTwentyId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "triggeredBy" TEXT NOT NULL,
    "webhookLogId" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobResult" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "JobResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "Tenant_slug_idx" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "Tenant_status_idx" ON "Tenant"("status");

-- CreateIndex
CREATE INDEX "Tenant_deletedAt_idx" ON "Tenant"("deletedAt");

-- CreateIndex
CREATE INDEX "ScoringRule_tenantId_idx" ON "ScoringRule"("tenantId");

-- CreateIndex
CREATE INDEX "ScoringRule_enabled_idx" ON "ScoringRule"("enabled");

-- CreateIndex
CREATE INDEX "ScoreHistory_tenantId_createdAt_idx" ON "ScoreHistory"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "ScoreHistory_personTwentyId_idx" ON "ScoreHistory"("personTwentyId");

-- CreateIndex
CREATE UNIQUE INDEX "EnrichmentProvider_tenantId_key" ON "EnrichmentProvider"("tenantId");

-- CreateIndex
CREATE INDEX "EnrichmentProvider_tenantId_idx" ON "EnrichmentProvider"("tenantId");

-- CreateIndex
CREATE INDEX "EnrichedPerson_tenantId_personEmail_idx" ON "EnrichedPerson"("tenantId", "personEmail");

-- CreateIndex
CREATE UNIQUE INDEX "EnrichedPerson_tenantId_personTwentyId_key" ON "EnrichedPerson"("tenantId", "personTwentyId");

-- CreateIndex
CREATE INDEX "WebhookLog_tenantId_status_idx" ON "WebhookLog"("tenantId", "status");

-- CreateIndex
CREATE INDEX "WebhookLog_event_idx" ON "WebhookLog"("event");

-- CreateIndex
CREATE INDEX "WebhookLog_createdAt_idx" ON "WebhookLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_resourceTwentyId_idx" ON "AuditLog"("resourceTwentyId");

-- CreateIndex
CREATE INDEX "JobResult_tenantId_jobType_idx" ON "JobResult"("tenantId", "jobType");

-- CreateIndex
CREATE INDEX "JobResult_status_idx" ON "JobResult"("status");

-- AddForeignKey
ALTER TABLE "ScoringRule" ADD CONSTRAINT "ScoringRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreHistory" ADD CONSTRAINT "ScoreHistory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookLog" ADD CONSTRAINT "WebhookLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
