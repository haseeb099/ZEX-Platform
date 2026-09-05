import { AgentId } from './agent-control.types';

/** Audit action → owning agent. Unmapped actions must not be attributed. */
const RESEARCH_ACTIONS = new Set([
  'research_run_created',
  'research_started',
  'research_finding_created',
  'research_finding_duplicate_detected',
  'research_completed',
  'research_failed',
  'research_blocked_not_approved',
  'research_blocked_agent_paused',
]);

const SDR_ACTIONS = new Set([
  'sdr_sequence_created',
  'sdr_draft_generated',
  'sdr_reply_draft_generated',
  'sdr_draft_superseded',
  'sdr_draft_rejected',
  'sdr_approval_granted',
  'sdr_approval_revoked',
  'sdr_send_started',
  'sdr_sent',
  'sdr_send_failed',
  'sdr_send_blocked_unapproved',
  'sdr_crm_sync_completed',
  'sdr_crm_sync_failed',
  'sdr_reply_received',
  'sdr_sequence_paused_on_reply',
  'sdr_meeting_booking_started',
  'sdr_meeting_booked',
  'sdr_blocked_agent_paused',
]);

const CONTROL_ACTIONS = new Set([
  'agent_control_paused',
  'agent_control_resumed',
  'agent_control_undo',
]);

/** Explicitly irreversible domain effects (never undo via Control Center). */
export const IRREVERSIBLE_ACTION_TYPES = new Set([
  'sdr_sent',
  'sdr_meeting_booked',
  'sdr_reply_received',
  'sdr_crm_sync_completed',
  'research_completed',
  'research_finding_created',
  'sdr_approval_granted',
  'sdr_draft_rejected',
  'prospect_candidate_crm_created',
]);

export function mapAuditActionToAgentId(
  action: string,
  after?: Record<string, unknown> | null,
): AgentId | null {
  if (CONTROL_ACTIONS.has(action)) {
    const agentId = after?.agentId;
    if (agentId === 'research_agent' || agentId === 'ai_sdr') return agentId;
    return null;
  }
  if (RESEARCH_ACTIONS.has(action) || action.startsWith('research_')) {
    return RESEARCH_ACTIONS.has(action) ? 'research_agent' : null;
  }
  if (SDR_ACTIONS.has(action) || action.startsWith('sdr_')) {
    return SDR_ACTIONS.has(action) ? 'ai_sdr' : null;
  }
  return null;
}

export function permissionKeyForAction(action: string, agentId: AgentId | null): string | null {
  if (!agentId) return null;
  if (action.startsWith('agent_control_')) return 'agent_control';
  if (agentId === 'research_agent') {
    if (action.includes('blocked')) return 'research_accounts';
    if (action.includes('finding')) return 'write_research_findings';
    if (action === 'research_completed') return 'produce_outreach_context';
    return 'research_accounts';
  }
  // ai_sdr
  if (action.includes('approval')) return 'approve_draft';
  if (action.includes('send') || action === 'sdr_sent') return 'send_outreach';
  if (action.includes('meeting')) return 'book_meeting';
  if (action.includes('reply') && action !== 'sdr_reply_draft_generated')
    return 'adapt_after_reply';
  if (action.includes('draft') || action.includes('sequence')) return 'draft_outreach';
  if (action.includes('crm')) return 'crm_sync';
  return 'draft_outreach';
}

export function isControlMutationReversible(action: string): boolean {
  return action === 'agent_control_paused' || action === 'agent_control_resumed';
}

export function isDomainActionReversible(action: string): boolean {
  if (isControlMutationReversible(action)) return true;
  return false;
}

export function deriveApprovalState(
  action: string,
  after?: Record<string, unknown> | null,
): string | null {
  if (action === 'sdr_draft_generated' || action === 'sdr_reply_draft_generated') {
    return 'awaiting_approval';
  }
  if (action === 'sdr_approval_granted') return 'approved';
  if (action === 'sdr_draft_rejected') return 'rejected';
  if (action === 'sdr_draft_superseded') return 'superseded';
  if (action === 'sdr_approval_revoked') return 'approval_revoked';
  if (action === 'sdr_sent') return 'sent';
  if (action === 'sdr_meeting_booking_started') return 'meeting_awaiting_confirmation';
  if (action === 'sdr_meeting_booked') return 'meeting_booked';
  if (action === 'sdr_send_blocked_unapproved') return 'send_blocked';
  if (typeof after?.status === 'string') return after.status;
  return null;
}

export function actionStatusFromAudit(action: string, success: boolean): string {
  if (!success) {
    if (action.includes('blocked')) return 'blocked';
    return 'failed';
  }
  if (action.includes('started') || action.endsWith('_created')) return 'started';
  if (action.includes('completed') || action === 'sdr_sent' || action === 'sdr_meeting_booked') {
    return 'completed';
  }
  if (action.includes('paused') || action.includes('resumed') || action === 'agent_control_undo') {
    return 'completed';
  }
  return 'recorded';
}
