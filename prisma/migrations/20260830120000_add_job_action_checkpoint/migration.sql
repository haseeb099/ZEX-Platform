-- Migration: add_job_action_checkpoint
-- Additive only: persistent CRM write checkpoints for enrich-and-score retry idempotency.
-- Scoped per tenant + webhookLogId + action; no data backfill required.

-- CreateTable
CREATE TABLE "JobActionCheckpoint" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "webhookLogId" TEXT NOT NULL,
    "personTwentyId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "externalId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobActionCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobActionCheckpoint_tenantId_webhookLogId_action_key" ON "JobActionCheckpoint"("tenantId", "webhookLogId", "action");

-- CreateIndex
CREATE INDEX "JobActionCheckpoint_tenantId_webhookLogId_idx" ON "JobActionCheckpoint"("tenantId", "webhookLogId");

-- CreateIndex
CREATE INDEX "JobActionCheckpoint_personTwentyId_idx" ON "JobActionCheckpoint"("personTwentyId");
