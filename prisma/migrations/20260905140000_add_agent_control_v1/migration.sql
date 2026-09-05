-- Migration: add_agent_control_v1
-- Per-tenant agent pause/resume control state (ZEX-39).

CREATE TABLE "TenantAgentControl" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'ACTIVE',
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantAgentControl_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantAgentControl_tenantId_agentId_key" ON "TenantAgentControl"("tenantId", "agentId");

CREATE INDEX "TenantAgentControl_tenantId_idx" ON "TenantAgentControl"("tenantId");

CREATE INDEX "TenantAgentControl_tenantId_state_idx" ON "TenantAgentControl"("tenantId", "state");

ALTER TABLE "TenantAgentControl" ADD CONSTRAINT "TenantAgentControl_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
