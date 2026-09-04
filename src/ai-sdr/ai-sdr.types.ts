import { z } from 'zod';

export const AI_SDR_VERSION = 'ai-sdr-v1';

export const SEQUENCE_STATUSES = [
  'DRAFTING',
  'AWAITING_APPROVAL',
  'APPROVED',
  'ACTIVE',
  'PAUSED',
  'REPLIED',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
] as const;
export type SequenceStatus = (typeof SEQUENCE_STATUSES)[number];

export const DRAFT_PURPOSES = ['outreach', 'follow_up', 'reply', 'meeting'] as const;
export type DraftPurpose = (typeof DRAFT_PURPOSES)[number];

export const REPLY_CLASSIFICATIONS = [
  'POSITIVE',
  'NEGATIVE',
  'QUESTION',
  'NOT_NOW',
  'OOO',
  'UNSUBSCRIBE',
  'UNKNOWN',
] as const;
export type ReplyClassification = (typeof REPLY_CLASSIFICATIONS)[number];

export const OUTBOUND_FIXTURES = ['success', 'transient_failure', 'permanent_failure'] as const;
export type OutboundFixture = (typeof OUTBOUND_FIXTURES)[number];

export type GeneratedDraftContent = {
  channel: 'email';
  purpose: DraftPurpose;
  subject: string;
  body: string;
  evidenceRefs: string[];
  researchFindingIds: string[];
  doNotClaimApplied: string[];
  grounding: {
    personalizationFacts: string[];
    whyNow?: string | null;
    companyName: string;
  };
  confidence: number;
};

export const replyEventSchema = z.object({
  tenantId: z.string().min(1),
  providerEventId: z.string().min(1),
  providerMessageId: z.string().min(1).optional(),
  sequenceId: z.string().min(1).optional(),
  classification: z.enum(REPLY_CLASSIFICATIONS).default('UNKNOWN'),
  sender: z.string().max(320).nullable().optional(),
  subject: z.string().max(500).nullable().optional(),
  bodySummary: z.string().max(1000).nullable().optional(),
  receivedAt: z.string().datetime().optional(),
});

export type ReplyEventInput = z.infer<typeof replyEventSchema>;

export type OutboundSendInput = {
  tenantId: string;
  sequenceId: string;
  draftId: string;
  messageId: string;
  idempotencyKey: string;
  toEmail: string;
  subject: string;
  body: string;
  fixture?: OutboundFixture;
};

export type OutboundSendResult = {
  provider: string;
  providerMessageId: string;
};

export interface OutboundMessageProvider {
  readonly name: string;
  sendEmail(input: OutboundSendInput): Promise<OutboundSendResult>;
}

export type MeetingProposeInput = {
  tenantId: string;
  sequenceId: string;
  prospectCandidateId: string;
  companyName: string;
};

export type MeetingProposeResult = {
  provider: string;
  bookingLink: string;
  proposedTimes: string[];
};

export type MeetingConfirmInput = {
  tenantId: string;
  bookingId: string;
  bookingLink: string;
};

export type MeetingConfirmResult = {
  provider: string;
  providerMeetingId: string;
};

export interface MeetingProvider {
  readonly name: string;
  propose(input: MeetingProposeInput): Promise<MeetingProposeResult>;
  confirm(input: MeetingConfirmInput): Promise<MeetingConfirmResult>;
}

export const OUTBOUND_MESSAGE_PROVIDER = Symbol('OUTBOUND_MESSAGE_PROVIDER');
export const MEETING_PROVIDER = Symbol('MEETING_PROVIDER');
