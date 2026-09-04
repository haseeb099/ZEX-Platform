-- Migration: add_why_now_v1
-- Additive: ProspectSignal + ProspectScoreSnapshot for Why-Now intent scoring.

CREATE TABLE "ProspectSignal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "prospectCandidateId" TEXT NOT NULL,
    "signalType" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "relevance" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "evidence" JSONB,
    "providerKey" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProspectSignal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProspectScoreSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "prospectCandidateId" TEXT NOT NULL,
    "fitScore" INTEGER NOT NULL,
    "intentScore" INTEGER NOT NULL,
    "timingScore" INTEGER NOT NULL,
    "overallScore" INTEGER NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "whyNow" TEXT NOT NULL,
    "fitReasons" JSONB,
    "intentReasons" JSONB,
    "timingReasons" JSONB,
    "signalIds" JSONB,
    "scoringVersion" TEXT NOT NULL DEFAULT 'why-now-v1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProspectScoreSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProspectSignal_tenantId_dedupeKey_key" ON "ProspectSignal"("tenantId", "dedupeKey");
CREATE INDEX "ProspectSignal_tenantId_prospectCandidateId_idx" ON "ProspectSignal"("tenantId", "prospectCandidateId");
CREATE INDEX "ProspectSignal_tenantId_signalType_idx" ON "ProspectSignal"("tenantId", "signalType");
CREATE INDEX "ProspectSignal_occurredAt_idx" ON "ProspectSignal"("occurredAt");

CREATE INDEX "ProspectScoreSnapshot_tenantId_prospectCandidateId_createdAt_idx" ON "ProspectScoreSnapshot"("tenantId", "prospectCandidateId", "createdAt");
CREATE INDEX "ProspectScoreSnapshot_tenantId_createdAt_idx" ON "ProspectScoreSnapshot"("tenantId", "createdAt");

ALTER TABLE "ProspectSignal" ADD CONSTRAINT "ProspectSignal_prospectCandidateId_fkey" FOREIGN KEY ("prospectCandidateId") REFERENCES "ProspectCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProspectScoreSnapshot" ADD CONSTRAINT "ProspectScoreSnapshot_prospectCandidateId_fkey" FOREIGN KEY ("prospectCandidateId") REFERENCES "ProspectCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
