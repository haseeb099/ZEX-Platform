import { z } from 'zod';

export const AGENT_CONTROL_VERSION = 'agent-control-v1';

export const AGENT_IDS = ['research_agent', 'ai_sdr'] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const AGENT_CONTROL_STATES = ['ACTIVE', 'PAUSED'] as const;
export type AgentControlState = (typeof AGENT_CONTROL_STATES)[number];

export const AGENT_STATUSES = ['paused', 'blocked', 'degraded', 'active', 'idle'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const PERMISSION_MODES = [
  'allowed',
  'approval_required',
  'not_allowed',
  'human_only',
] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export type AgentPermission = {
  key: string;
  label: string;
  mode: PermissionMode;
  description: string;
};

export type AgentApprovalPolicy = {
  summary: string;
  /** Human must approve before these effects. */
  requiresHumanApproval: string[];
  /** Explicitly never auto-performed by the agent. */
  neverAutonomous: string[];
};

export type AgentDefinition = {
  id: AgentId;
  name: string;
  description: string;
  permissions: AgentPermission[];
  approvalPolicy: AgentApprovalPolicy;
};

export type ConfidenceValue = number | null | 'not_applicable';

export type AgentActionEvidence = {
  label: string;
  text: string;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  evidenceType?: string | null;
  findingId?: string | null;
  draftVersion?: number | null;
  contentHash?: string | null;
  whyNow?: string | null;
  replyClassification?: string | null;
  meetingStatus?: string | null;
  doNotClaim?: string[] | null;
};

export type UndoState = {
  status: 'none' | 'available' | 'undone' | 'not_reversible';
  undoneByActionId?: string | null;
  undoneAt?: string | null;
};

export type AgentAction = {
  id: string;
  agentId: AgentId | null;
  actionType: string;
  status: string;
  occurredAt: string;
  updatedAt: string;
  subject: {
    resourceType: string | null;
    resourceId: string | null;
    summary: string | null;
  };
  evidenceSummary: AgentActionEvidence[];
  confidence: ConfidenceValue;
  permissionKey: string | null;
  approvalState: string | null;
  triggeredBy: string;
  mutationSummary: {
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    success: boolean;
    message: string | null;
  };
  reversible: boolean;
  undo: UndoState;
  auditLogId: string;
};

export type AgentMetrics = {
  currentWork: number;
  recentFailures: number;
  recentBlocked: number;
  awaitingApproval: number;
  lastActivityAt: string | null;
};

export type AgentOverviewItem = {
  id: AgentId;
  name: string;
  description: string;
  status: AgentStatus;
  controlState: AgentControlState;
  health: {
    operational: boolean;
    detail: string;
  };
  permissions: AgentPermission[];
  approvalPolicy: AgentApprovalPolicy;
  metrics: AgentMetrics;
  recentActions: AgentAction[];
};

export type AgentControlOverviewResponse = {
  version: string;
  tenantId: string;
  generatedAt: string;
  agents: AgentOverviewItem[];
};

export const agentIdSchema = z.enum(AGENT_IDS);

export const agentsQuerySchema = z.object({
  recentLimit: z.coerce.number().int().min(1).max(50).default(10),
});

export const agentActionsQuerySchema = z.object({
  agentId: agentIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const undoBodySchema = z
  .object({
    triggeredBy: z.string().min(1).max(200).optional(),
  })
  .default({});

export function isAgentId(value: string): value is AgentId {
  return (AGENT_IDS as readonly string[]).includes(value);
}

/** Bound nested JSON for API responses — never return unbounded blobs. */
export function boundJson(
  value: unknown,
  maxDepth = 3,
  maxKeys = 40,
  maxString = 500,
): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') {
    return { value: typeof value === 'string' ? value.slice(0, maxString) : value };
  }
  return boundObject(value as Record<string, unknown>, maxDepth, maxKeys, maxString);
}

function boundObject(
  obj: Record<string, unknown>,
  depth: number,
  maxKeys: number,
  maxString: number,
): Record<string, unknown> {
  if (depth <= 0) return { truncated: true };
  const out: Record<string, unknown> = {};
  let i = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (i++ >= maxKeys) {
      out._truncated = true;
      break;
    }
    if (v === null || v === undefined) {
      out[k] = v;
    } else if (typeof v === 'string') {
      out[k] = v.slice(0, maxString);
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    } else if (Array.isArray(v)) {
      out[k] = v.slice(0, 20).map(item => {
        if (item && typeof item === 'object') {
          return boundObject(item as Record<string, unknown>, depth - 1, maxKeys, maxString);
        }
        return typeof item === 'string' ? item.slice(0, maxString) : item;
      });
    } else if (typeof v === 'object') {
      out[k] = boundObject(v as Record<string, unknown>, depth - 1, maxKeys, maxString);
    }
  }
  return out;
}
