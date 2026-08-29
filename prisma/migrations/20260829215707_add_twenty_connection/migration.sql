-- Migration: add_twenty_connection
-- Non-destructive: adds TwentyConnection only. Legacy Tenant columns remain:
--   twentyWorkspaceId, twentyApiKey, twentyWebhookSecret
-- No automatic SQL backfill: baseUrl/graphqlUrl/restUrl cannot be inferred
-- safely from workspaceId alone. Do not invent customer Twenty endpoints.
-- Provision TwentyConnection via create-tenant API (or an explicit ops script
-- that supplies real URLs) before relying on tenant CRM calls.

-- CreateTable
CREATE TABLE "TwentyConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "graphqlUrl" TEXT NOT NULL,
    "restUrl" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "twentyVersion" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TwentyConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TwentyConnection_tenantId_key" ON "TwentyConnection"("tenantId");

-- CreateIndex
CREATE INDEX "TwentyConnection_workspaceId_idx" ON "TwentyConnection"("workspaceId");

-- CreateIndex
CREATE INDEX "TwentyConnection_status_idx" ON "TwentyConnection"("status");

-- AddForeignKey
ALTER TABLE "TwentyConnection" ADD CONSTRAINT "TwentyConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
