-- Migration: add_ai_sdr_v1
-- Platform-owned AI SDR sequences, drafts, approvals, messages, replies, meetings.
-- No Twenty schema changes.

CREATE TABLE "SdrSequence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "prospectCandidateId" TEXT NOT NULL,
    "researchRunId" TEXT,
    "whyNowSnapshotId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFTING',
    "channel" TEXT NOT NULL DEFAULT 'email',
    "targetEmail" TEXT,
    "targetPersonTwentyId" TEXT,
    "targetPersonName" TEXT,
    "crmSyncStatus" TEXT NOT NULL DEFAULT 'NONE',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SdrSequence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SdrDraft" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "prospectCandidateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "purpose" TEXT NOT NULL DEFAULT 'outreach',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "evidenceRefs" JSONB,
    "researchFindingIds" JSONB,
    "whyNowSnapshotId" TEXT,
    "doNotClaimApplied" JSONB,
    "grounding" JSONB,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "contentHash" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SdrDraft_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SdrApproval" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "draftVersion" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SdrApproval_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SdrMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "approvalId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "provider" TEXT,
    "providerMessageId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "error" TEXT,
    "crmSyncStatus" TEXT NOT NULL DEFAULT 'NONE',
    "crmSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SdrMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SdrReply" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "messageId" TEXT,
    "providerEventId" TEXT NOT NULL,
    "classification" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "sender" TEXT,
    "subject" TEXT,
    "bodySummary" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SdrReply_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SdrMeetingBooking" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "prospectCandidateId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "bookingLink" TEXT,
    "providerMeetingId" TEXT,
    "schedulingDraftId" TEXT,
    "proposedTimes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SdrMeetingBooking_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SdrSequence_tenantId_prospectCandidateId_idx" ON "SdrSequence"("tenantId", "prospectCandidateId");
CREATE INDEX "SdrSequence_tenantId_status_idx" ON "SdrSequence"("tenantId", "status");
CREATE INDEX "SdrSequence_tenantId_createdAt_idx" ON "SdrSequence"("tenantId", "createdAt");

CREATE UNIQUE INDEX "SdrDraft_sequenceId_version_key" ON "SdrDraft"("sequenceId", "version");
CREATE INDEX "SdrDraft_tenantId_sequenceId_idx" ON "SdrDraft"("tenantId", "sequenceId");
CREATE INDEX "SdrDraft_tenantId_prospectCandidateId_idx" ON "SdrDraft"("tenantId", "prospectCandidateId");
CREATE INDEX "SdrDraft_tenantId_contentHash_idx" ON "SdrDraft"("tenantId", "contentHash");

CREATE INDEX "SdrApproval_tenantId_draftId_idx" ON "SdrApproval"("tenantId", "draftId");
CREATE INDEX "SdrApproval_tenantId_sequenceId_idx" ON "SdrApproval"("tenantId", "sequenceId");
CREATE INDEX "SdrApproval_tenantId_status_idx" ON "SdrApproval"("tenantId", "status");

CREATE UNIQUE INDEX "SdrMessage_tenantId_idempotencyKey_key" ON "SdrMessage"("tenantId", "idempotencyKey");
CREATE INDEX "SdrMessage_tenantId_sequenceId_idx" ON "SdrMessage"("tenantId", "sequenceId");
CREATE INDEX "SdrMessage_tenantId_draftId_idx" ON "SdrMessage"("tenantId", "draftId");
CREATE INDEX "SdrMessage_tenantId_providerMessageId_idx" ON "SdrMessage"("tenantId", "providerMessageId");
CREATE INDEX "SdrMessage_tenantId_status_idx" ON "SdrMessage"("tenantId", "status");

CREATE UNIQUE INDEX "SdrReply_tenantId_providerEventId_key" ON "SdrReply"("tenantId", "providerEventId");
CREATE INDEX "SdrReply_tenantId_sequenceId_idx" ON "SdrReply"("tenantId", "sequenceId");
CREATE INDEX "SdrReply_tenantId_messageId_idx" ON "SdrReply"("tenantId", "messageId");

CREATE INDEX "SdrMeetingBooking_tenantId_sequenceId_idx" ON "SdrMeetingBooking"("tenantId", "sequenceId");
CREATE INDEX "SdrMeetingBooking_tenantId_status_idx" ON "SdrMeetingBooking"("tenantId", "status");

ALTER TABLE "SdrSequence" ADD CONSTRAINT "SdrSequence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SdrSequence" ADD CONSTRAINT "SdrSequence_prospectCandidateId_fkey" FOREIGN KEY ("prospectCandidateId") REFERENCES "ProspectCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SdrDraft" ADD CONSTRAINT "SdrDraft_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "SdrSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SdrApproval" ADD CONSTRAINT "SdrApproval_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "SdrSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SdrApproval" ADD CONSTRAINT "SdrApproval_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "SdrDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SdrMessage" ADD CONSTRAINT "SdrMessage_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "SdrSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SdrMessage" ADD CONSTRAINT "SdrMessage_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "SdrDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SdrMessage" ADD CONSTRAINT "SdrMessage_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "SdrApproval"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SdrReply" ADD CONSTRAINT "SdrReply_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "SdrSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SdrReply" ADD CONSTRAINT "SdrReply_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "SdrMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SdrMeetingBooking" ADD CONSTRAINT "SdrMeetingBooking_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "SdrSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
