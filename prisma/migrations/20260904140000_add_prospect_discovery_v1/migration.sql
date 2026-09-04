-- Migration: add_prospect_discovery_v1
-- Additive only: Prospect Discovery runs/candidates (Platform-owned until CRM approval).

CREATE TABLE "ProspectDiscoveryRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyBrainId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "provider" TEXT,
    "error" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProspectDiscoveryRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProspectCandidate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "discoveryRunId" TEXT NOT NULL,
    "providerKey" TEXT,
    "companyName" TEXT NOT NULL,
    "domain" TEXT,
    "websiteUrl" TEXT,
    "industry" TEXT,
    "companySize" TEXT,
    "geography" TEXT,
    "description" TEXT,
    "fitScore" INTEGER NOT NULL DEFAULT 0,
    "fitBand" TEXT NOT NULL DEFAULT 'unknown',
    "fitReasons" JSONB,
    "disqualifiers" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "dedupeStatus" TEXT NOT NULL DEFAULT 'NEW',
    "existingTwentyCompanyId" TEXT,
    "createdTwentyCompanyId" TEXT,
    "evidence" JSONB,
    "buyerRoles" JSONB,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProspectCandidate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProspectDiscoveryRun_tenantId_createdAt_idx" ON "ProspectDiscoveryRun"("tenantId", "createdAt");
CREATE INDEX "ProspectDiscoveryRun_tenantId_status_idx" ON "ProspectDiscoveryRun"("tenantId", "status");
CREATE INDEX "ProspectDiscoveryRun_companyBrainId_idx" ON "ProspectDiscoveryRun"("companyBrainId");

CREATE INDEX "ProspectCandidate_tenantId_discoveryRunId_idx" ON "ProspectCandidate"("tenantId", "discoveryRunId");
CREATE INDEX "ProspectCandidate_tenantId_status_idx" ON "ProspectCandidate"("tenantId", "status");
CREATE INDEX "ProspectCandidate_domain_idx" ON "ProspectCandidate"("domain");

ALTER TABLE "ProspectDiscoveryRun" ADD CONSTRAINT "ProspectDiscoveryRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProspectCandidate" ADD CONSTRAINT "ProspectCandidate_discoveryRunId_fkey" FOREIGN KEY ("discoveryRunId") REFERENCES "ProspectDiscoveryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
