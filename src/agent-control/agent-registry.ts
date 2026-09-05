import { AgentDefinition, AgentId } from './agent-control.types';

export const AGENT_REGISTRY: Record<AgentId, AgentDefinition> = {
  research_agent: {
    id: 'research_agent',
    name: 'Research Agent',
    description:
      'Source-backed research for approved prospects. Produces findings and outreach context; never mutates CRM.',
    permissions: [
      {
        key: 'research_accounts',
        label: 'Research approved accounts',
        mode: 'allowed',
        description: 'Run research on APPROVED or CREATED ProspectCandidates only.',
      },
      {
        key: 'read_why_now',
        label: 'Read Why-Now / evidence',
        mode: 'allowed',
        description: 'Read score snapshots and signals for research grounding.',
      },
      {
        key: 'write_research_findings',
        label: 'Write research findings',
        mode: 'allowed',
        description: 'Persist provenance-backed Platform findings and research packages.',
      },
      {
        key: 'produce_outreach_context',
        label: 'Produce outreach context',
        mode: 'allowed',
        description: 'Emit personalizationFacts / doNotClaim for downstream SDR drafts.',
      },
      {
        key: 'mutate_crm',
        label: 'Mutate CRM',
        mode: 'not_allowed',
        description: 'Research Agent has zero Twenty write surface.',
      },
      {
        key: 'send_outreach',
        label: 'Send outreach',
        mode: 'not_allowed',
        description: 'Sending is owned by AI SDR with exact-draft approval.',
      },
    ],
    approvalPolicy: {
      summary: 'Prospect must already be APPROVED/CREATED; research does not grant send rights.',
      requiresHumanApproval: ['prospect_approval_before_research'],
      neverAutonomous: ['crm_write', 'email_send', 'meeting_book'],
    },
  },
  ai_sdr: {
    id: 'ai_sdr',
    name: 'AI SDR',
    description:
      'Approval-first outreach: drafts from research/Why-Now, send only after exact draft approval, stop/adapt on reply.',
    permissions: [
      {
        key: 'read_research',
        label: 'Read research + Why-Now',
        mode: 'allowed',
        description: 'Consume completed Research Agent packages and score context.',
      },
      {
        key: 'draft_outreach',
        label: 'Create personalized drafts',
        mode: 'allowed',
        description: 'Generate versioned drafts (outreach/follow_up/reply/meeting).',
      },
      {
        key: 'approve_draft',
        label: 'Approve draft',
        mode: 'human_only',
        description: 'Exact draft id + contentHash + version approval is human-only.',
      },
      {
        key: 'send_outreach',
        label: 'Send outreach',
        mode: 'approval_required',
        description: 'Send only after active exact-draft approval; no Control Center auto-send.',
      },
      {
        key: 'adapt_after_reply',
        label: 'Adapt after reply',
        mode: 'allowed',
        description:
          'May draft reply/meeting suggestions only; still requires new approval to send.',
      },
      {
        key: 'book_meeting',
        label: 'Book meeting',
        mode: 'approval_required',
        description: 'Meeting confirm is an explicit human confirmation workflow.',
      },
      {
        key: 'crm_sync',
        label: 'CRM sync notes',
        mode: 'allowed',
        description: 'Best-effort CRM note sync after send/reply where existing workflow permits.',
      },
      {
        key: 'auto_send',
        label: 'Auto-send from Control Center',
        mode: 'not_allowed',
        description: 'Never auto-send; pause does not grant send rights.',
      },
    ],
    approvalPolicy: {
      summary:
        'No outbound send without explicit human approval of that exact draft version/content hash.',
      requiresHumanApproval: [
        'draft_approval_before_send',
        'meeting_confirm',
        'new_draft_after_supersede',
      ],
      neverAutonomous: ['email_send_without_approval', 'auto_send', 'unsend_email'],
    },
  },
};

export function getAgentDefinition(agentId: AgentId): AgentDefinition {
  return AGENT_REGISTRY[agentId];
}

export function listAgentDefinitions(): AgentDefinition[] {
  return Object.values(AGENT_REGISTRY);
}
