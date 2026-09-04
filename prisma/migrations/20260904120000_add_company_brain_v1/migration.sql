-- Migration: add_company_brain_v1
-- Additive only: Company Brain canonical intelligence models (tenant-scoped).
-- Not coupled to Twenty object schemas.

-- CreateTable
CREATE TABLE "CompanyBrain" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "websiteUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "generatedPayload" JSONB,
    "payload" JSONB,
    "userOverrides" JSONB,
    "lastAnalyzedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyBrain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyBrainSource" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyBrainId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "title" TEXT,
    "rawText" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyBrainSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyBrainAnalysisJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyBrainId" TEXT NOT NULL,
    "bullJobId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CompanyBrainAnalysisJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyBrain_tenantId_updatedAt_idx" ON "CompanyBrain"("tenantId", "updatedAt");

-- CreateIndex
CREATE INDEX "CompanyBrain_tenantId_status_idx" ON "CompanyBrain"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyBrainSource_companyBrainId_contentHash_key" ON "CompanyBrainSource"("companyBrainId", "contentHash");

-- CreateIndex
CREATE INDEX "CompanyBrainSource_tenantId_companyBrainId_idx" ON "CompanyBrainSource"("tenantId", "companyBrainId");

-- CreateIndex
CREATE INDEX "CompanyBrainAnalysisJob_tenantId_companyBrainId_idx" ON "CompanyBrainAnalysisJob"("tenantId", "companyBrainId");

-- CreateIndex
CREATE INDEX "CompanyBrainAnalysisJob_status_idx" ON "CompanyBrainAnalysisJob"("status");

-- AddForeignKey
ALTER TABLE "CompanyBrain" ADD CONSTRAINT "CompanyBrain_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyBrainSource" ADD CONSTRAINT "CompanyBrainSource_companyBrainId_fkey" FOREIGN KEY ("companyBrainId") REFERENCES "CompanyBrain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyBrainAnalysisJob" ADD CONSTRAINT "CompanyBrainAnalysisJob_companyBrainId_fkey" FOREIGN KEY ("companyBrainId") REFERENCES "CompanyBrain"("id") ON DELETE CASCADE ON UPDATE CASCADE;
