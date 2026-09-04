-- Migration: add_research_agent_v1
-- Platform-owned ProspectResearchRun + ProspectResearchFinding.
-- No Twenty/CRM tables touched.

-- CreateTable
CREATE TABLE "ProspectResearchRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "prospectCandidateId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "triggeredBy" TEXT,
    "researchVersion" TEXT NOT NULL DEFAULT 'research-agent-v1',
    "package" JSONB,
    "confidence" DOUBLE PRECISION,
    "whyNowSnapshotId" TEXT,
    "findingCount" INTEGER NOT NULL DEFAULT 0,
    "fixture" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProspectResearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProspectResearchFinding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "researchRunId" TEXT NOT NULL,
    "prospectCandidateId" TEXT NOT NULL,
    "findingType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "claim" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceTitle" TEXT,
    "sourceType" TEXT,
    "excerpt" TEXT,
    "occurredAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "relevance" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "evidenceType" TEXT NOT NULL DEFAULT 'EXPLICIT',
    "personName" TEXT,
    "personRole" TEXT,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "providerKey" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProspectResearchFinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProspectResearchRun_tenantId_prospectCandidateId_createdAt_idx" ON "ProspectResearchRun"("tenantId", "prospectCandidateId", "createdAt");

-- CreateIndex
CREATE INDEX "ProspectResearchRun_tenantId_status_idx" ON "ProspectResearchRun"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ProspectResearchRun_tenantId_createdAt_idx" ON "ProspectResearchRun"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProspectResearchFinding_tenantId_dedupeKey_key" ON "ProspectResearchFinding"("tenantId", "dedupeKey");

-- CreateIndex
CREATE INDEX "ProspectResearchFinding_tenantId_prospectCandidateId_idx" ON "ProspectResearchFinding"("tenantId", "prospectCandidateId");

-- CreateIndex
CREATE INDEX "ProspectResearchFinding_tenantId_researchRunId_idx" ON "ProspectResearchFinding"("tenantId", "researchRunId");

-- CreateIndex
CREATE INDEX "ProspectResearchFinding_tenantId_findingType_idx" ON "ProspectResearchFinding"("tenantId", "findingType");

-- AddForeignKey
ALTER TABLE "ProspectResearchRun" ADD CONSTRAINT "ProspectResearchRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectResearchRun" ADD CONSTRAINT "ProspectResearchRun_prospectCandidateId_fkey" FOREIGN KEY ("prospectCandidateId") REFERENCES "ProspectCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectResearchFinding" ADD CONSTRAINT "ProspectResearchFinding_researchRunId_fkey" FOREIGN KEY ("researchRunId") REFERENCES "ProspectResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectResearchFinding" ADD CONSTRAINT "ProspectResearchFinding_prospectCandidateId_fkey" FOREIGN KEY ("prospectCandidateId") REFERENCES "ProspectCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
