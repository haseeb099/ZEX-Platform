import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditLog } from '@prisma/client';
import { AuditService } from '@src/audit/audit.service';
import { PrismaService } from '@src/common/prisma/prisma.service';
import { redactSecrets } from '@src/common/redact-secrets';
import {
  actionStatusFromAudit,
  computeLatestEligibleControlActions,
  deriveApprovalState,
  isControlMutationReversible,
  isDomainActionReversible,
  mapAuditActionToAgentId,
  permissionKeyForAction,
} from './agent-action-mapper';
import { getAgentDefinition, listAgentDefinitions } from './agent-registry';
import {
  AGENT_ACTION_HISTORY_WINDOW,
  AGENT_CONTROL_VERSION,
  AgentAction,
  AgentControlOverviewResponse,
  AgentControlState,
  AgentId,
  AgentMetrics,
  AgentOverviewItem,
  AgentStatus,
  ConfidenceValue,
  boundJson,
  isAgentId,
} from './agent-control.types';

const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const CONTROL_TIMELINE_ACTIONS = [
  'agent_control_paused',
  'agent_control_resumed',
  'agent_control_undo',
] as const;

@Injectable()
export class AgentControlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async assertTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async getControlState(tenantId: string, agentId: AgentId): Promise<AgentControlState> {
    const row = await this.prisma.tenantAgentControl.findUnique({
      where: { tenantId_agentId: { tenantId, agentId } },
    });
    return (row?.state as AgentControlState) || 'ACTIVE';
  }

  /** Fail-closed gate for new agent work. */
  async assertAgentNotPaused(tenantId: string, agentId: AgentId, triggeredBy = 'system') {
    const state = await this.getControlState(tenantId, agentId);
    if (state === 'PAUSED') {
      await this.audit.log({
        tenantId,
        action:
          agentId === 'research_agent'
            ? 'research_blocked_agent_paused'
            : 'sdr_blocked_agent_paused',
        resourceType: 'TenantAgentControl',
        resourceTwentyId: `${tenantId}:${agentId}`,
        success: false,
        after: { agentId, state: 'PAUSED' },
        message: `Agent ${agentId} is paused`,
        triggeredBy,
      });
      throw new BadRequestException(`Agent ${agentId} is paused`);
    }
  }

  async isPaused(tenantId: string, agentId: AgentId): Promise<boolean> {
    return (await this.getControlState(tenantId, agentId)) === 'PAUSED';
  }

  async getOverview(tenantId: string, recentLimit = 10): Promise<AgentControlOverviewResponse> {
    await this.assertTenant(tenantId);
    const agents = await Promise.all(
      listAgentDefinitions().map(def => this.buildAgentOverview(tenantId, def.id, recentLimit)),
    );
    return {
      version: AGENT_CONTROL_VERSION,
      tenantId,
      generatedAt: new Date().toISOString(),
      agents,
    };
  }

  async listActions(tenantId: string, opts: { agentId?: AgentId; limit: number; offset: number }) {
    await this.assertTenant(tenantId);
    // Finite newest-first scan window — `total` is count within this window after mapping, not global.
    const logs = await this.prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: AGENT_ACTION_HISTORY_WINDOW,
      skip: 0,
    });

    const { undoneMap, latestEligibleByAgent } = await this.loadControlUndoContext(tenantId);
    let actions = logs
      .map(log => this.normalizeAuditToAction(log, undoneMap, latestEligibleByAgent))
      .filter((a): a is AgentAction => a !== null);

    if (opts.agentId) {
      actions = actions.filter(a => a.agentId === opts.agentId);
    }

    const totalInWindow = actions.length;
    const page = actions.slice(opts.offset, opts.offset + opts.limit);
    return {
      version: AGENT_CONTROL_VERSION,
      tenantId,
      /** Count of mapped agent actions inside the scanned history window (not a global DB total). */
      total: totalInWindow,
      historyWindowLimit: AGENT_ACTION_HISTORY_WINDOW,
      historyWindowComplete: logs.length < AGENT_ACTION_HISTORY_WINDOW,
      limit: opts.limit,
      offset: opts.offset,
      actions: page,
    };
  }

  async pauseAgent(tenantId: string, agentId: string, triggeredBy = 'admin-api') {
    if (!isAgentId(agentId)) throw new NotFoundException(`Unknown agent: ${agentId}`);
    await this.assertTenant(tenantId);

    const before = await this.getControlState(tenantId, agentId);
    if (before === 'PAUSED') {
      const existing = await this.prisma.tenantAgentControl.findUnique({
        where: { tenantId_agentId: { tenantId, agentId } },
      });
      return {
        agentId,
        state: 'PAUSED' as const,
        idempotent: true,
        control: existing,
      };
    }

    const control = await this.prisma.tenantAgentControl.upsert({
      where: { tenantId_agentId: { tenantId, agentId } },
      create: {
        tenantId,
        agentId,
        state: 'PAUSED',
        updatedBy: triggeredBy,
      },
      update: {
        state: 'PAUSED',
        updatedBy: triggeredBy,
      },
    });

    const auditRow = await this.audit.log({
      tenantId,
      action: 'agent_control_paused',
      resourceType: 'TenantAgentControl',
      resourceTwentyId: control.id,
      before: { agentId, state: before },
      after: {
        agentId,
        state: 'PAUSED',
        reversible: true,
        mutationKind: 'pause',
      },
      triggeredBy,
    });

    return {
      agentId,
      state: 'PAUSED' as const,
      idempotent: false,
      actionId: auditRow.id,
      reversible: true,
      control,
      auditLogId: auditRow.id,
    };
  }

  async resumeAgent(tenantId: string, agentId: string, triggeredBy = 'admin-api') {
    if (!isAgentId(agentId)) throw new NotFoundException(`Unknown agent: ${agentId}`);
    await this.assertTenant(tenantId);

    const before = await this.getControlState(tenantId, agentId);
    if (before === 'ACTIVE') {
      const existing = await this.prisma.tenantAgentControl.findUnique({
        where: { tenantId_agentId: { tenantId, agentId } },
      });
      return {
        agentId,
        state: 'ACTIVE' as const,
        idempotent: true,
        control: existing ?? { tenantId, agentId, state: 'ACTIVE' },
      };
    }

    const control = await this.prisma.tenantAgentControl.upsert({
      where: { tenantId_agentId: { tenantId, agentId } },
      create: {
        tenantId,
        agentId,
        state: 'ACTIVE',
        updatedBy: triggeredBy,
      },
      update: {
        state: 'ACTIVE',
        updatedBy: triggeredBy,
      },
    });

    const auditRow = await this.audit.log({
      tenantId,
      action: 'agent_control_resumed',
      resourceType: 'TenantAgentControl',
      resourceTwentyId: control.id,
      before: { agentId, state: before },
      after: {
        agentId,
        state: 'ACTIVE',
        reversible: true,
        mutationKind: 'resume',
      },
      triggeredBy,
    });

    return {
      agentId,
      state: 'ACTIVE' as const,
      idempotent: false,
      actionId: auditRow.id,
      reversible: true,
      control,
      auditLogId: auditRow.id,
    };
  }

  /**
   * Undo the latest effective reversible agent-control pause/resume mutation.
   * Superseded historical control mutations are rejected (409) — they must not
   * overwrite newer user intent. Second undo of the same action is idempotent.
   */
  async undoAction(tenantId: string, actionId: string, triggeredBy = 'admin-api') {
    await this.assertTenant(tenantId);

    const log = await this.prisma.auditLog.findFirst({
      where: { id: actionId, tenantId },
    });
    if (!log) throw new NotFoundException('Agent action not found');

    const after = (log.after as Record<string, unknown> | null) || null;
    const agentIdRaw = after?.agentId;
    const agentId = typeof agentIdRaw === 'string' && isAgentId(agentIdRaw) ? agentIdRaw : null;

    if (!isControlMutationReversible(log.action) || after?.reversible !== true) {
      if (
        log.action === 'sdr_sent' ||
        log.action === 'sdr_meeting_booked' ||
        !isDomainActionReversible(log.action)
      ) {
        throw new BadRequestException(
          `Action ${log.action} is not reversible (irreversible domain effect)`,
        );
      }
      throw new BadRequestException(`Action ${log.action} is not reversible`);
    }

    if (!agentId) {
      throw new BadRequestException('Control action missing agentId');
    }

    const { undoneMap, latestEligibleByAgent } = await this.loadControlUndoContext(tenantId);
    const existingUndo = undoneMap.get(actionId);

    if (existingUndo) {
      const current = await this.getControlState(tenantId, agentId);
      return {
        undone: true,
        idempotent: true,
        actionId,
        undoActionId: existingUndo.undoActionId,
        agentId,
        state: current,
      };
    }

    const latestEligible = latestEligibleByAgent.get(agentId) ?? null;
    if (latestEligible !== actionId) {
      throw new ConflictException(
        `Action ${actionId} is superseded by a newer control mutation for ${agentId}; only the latest effective pause/resume may be undone`,
      );
    }

    const beforeState = (log.before as Record<string, unknown> | null)?.state;
    const restoreState: AgentControlState =
      beforeState === 'PAUSED' || beforeState === 'ACTIVE'
        ? beforeState
        : log.action === 'agent_control_paused'
          ? 'ACTIVE'
          : 'PAUSED';

    const current = await this.getControlState(tenantId, agentId);
    const control = await this.prisma.tenantAgentControl.upsert({
      where: { tenantId_agentId: { tenantId, agentId } },
      create: {
        tenantId,
        agentId,
        state: restoreState,
        updatedBy: triggeredBy,
      },
      update: {
        state: restoreState,
        updatedBy: triggeredBy,
      },
    });

    const undoAudit = await this.audit.log({
      tenantId,
      action: 'agent_control_undo',
      resourceType: 'TenantAgentControl',
      resourceTwentyId: control.id,
      before: { agentId, state: current, undoOf: actionId },
      after: {
        agentId,
        state: restoreState,
        undoOf: actionId,
        reversible: false,
        mutationKind: 'undo',
      },
      triggeredBy,
      message: `Undid ${log.action}`,
    });

    return {
      undone: true,
      idempotent: false,
      actionId,
      undoActionId: undoAudit.id,
      agentId,
      state: restoreState,
      control,
      auditLogId: undoAudit.id,
    };
  }

  private async buildAgentOverview(
    tenantId: string,
    agentId: AgentId,
    recentLimit: number,
  ): Promise<AgentOverviewItem> {
    const def = getAgentDefinition(agentId);
    const controlState = await this.getControlState(tenantId, agentId);
    const metrics = await this.computeMetrics(tenantId, agentId);
    const status = this.deriveStatus(controlState, metrics);
    const recentActions = await this.recentActionsForAgent(tenantId, agentId, recentLimit);

    return {
      id: def.id,
      name: def.name,
      description: def.description,
      status,
      controlState,
      health: {
        operational: controlState === 'ACTIVE' && status !== 'degraded' && status !== 'blocked',
        detail:
          controlState === 'PAUSED'
            ? 'Paused — new agent work blocked'
            : status === 'blocked'
              ? 'Recent blocked/failed runs need attention'
              : status === 'degraded'
                ? 'Elevated recent failures'
                : status === 'active'
                  ? 'Current work in progress'
                  : 'Idle — no current work',
      },
      permissions: def.permissions,
      approvalPolicy: def.approvalPolicy,
      metrics,
      recentActions,
    };
  }

  private deriveStatus(controlState: AgentControlState, metrics: AgentMetrics): AgentStatus {
    if (controlState === 'PAUSED') return 'paused';
    if (metrics.recentBlocked > 0 && metrics.currentWork === 0) return 'blocked';
    if (metrics.recentFailures >= 3) return 'degraded';
    if (metrics.currentWork > 0 || metrics.awaitingApproval > 0) return 'active';
    return 'idle';
  }

  private async computeMetrics(tenantId: string, agentId: AgentId): Promise<AgentMetrics> {
    const since = new Date(Date.now() - RECENT_WINDOW_MS);

    if (agentId === 'research_agent') {
      const [currentWork, recentFailures, recentBlocked, lastRun] = await Promise.all([
        this.prisma.prospectResearchRun.count({
          where: { tenantId, status: { in: ['QUEUED', 'PROCESSING'] } },
        }),
        this.prisma.prospectResearchRun.count({
          where: { tenantId, status: 'FAILED', updatedAt: { gte: since } },
        }),
        this.prisma.prospectResearchRun.count({
          where: { tenantId, status: 'BLOCKED', updatedAt: { gte: since } },
        }),
        this.prisma.prospectResearchRun.findFirst({
          where: { tenantId },
          orderBy: { updatedAt: 'desc' },
          select: { updatedAt: true },
        }),
      ]);
      return {
        currentWork,
        recentFailures,
        recentBlocked,
        awaitingApproval: 0,
        lastActivityAt: lastRun?.updatedAt.toISOString() ?? null,
      };
    }

    const [currentWork, recentFailures, awaitingApproval, lastSeq] = await Promise.all([
      this.prisma.sdrSequence.count({
        where: {
          tenantId,
          status: { in: ['DRAFTING', 'AWAITING_APPROVAL', 'APPROVED', 'ACTIVE'] },
        },
      }),
      this.prisma.sdrSequence.count({
        where: { tenantId, status: 'FAILED', updatedAt: { gte: since } },
      }),
      this.prisma.sdrDraft.count({
        where: { tenantId, status: 'AWAITING_APPROVAL' },
      }),
      this.prisma.sdrSequence.findFirst({
        where: { tenantId },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      }),
    ]);

    const recentBlocked = await this.prisma.auditLog.count({
      where: {
        tenantId,
        action: { in: ['sdr_send_blocked_unapproved', 'sdr_blocked_agent_paused'] },
        createdAt: { gte: since },
      },
    });

    return {
      currentWork,
      recentFailures,
      recentBlocked,
      awaitingApproval,
      lastActivityAt: lastSeq?.updatedAt.toISOString() ?? null,
    };
  }

  private async recentActionsForAgent(
    tenantId: string,
    agentId: AgentId,
    limit: number,
  ): Promise<AgentAction[]> {
    const logs = await this.prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: AGENT_ACTION_HISTORY_WINDOW,
    });
    const { undoneMap, latestEligibleByAgent } = await this.loadControlUndoContext(tenantId);
    const actions: AgentAction[] = [];
    for (const log of logs) {
      const action = this.normalizeAuditToAction(log, undoneMap, latestEligibleByAgent);
      if (!action || action.agentId !== agentId) continue;
      actions.push(action);
      if (actions.length >= limit) break;
    }
    return actions;
  }

  /**
   * Load undo map + latest-effective pause/resume id per agent.
   * Conservative rule: only the newest un-undone pause/resume is eligible;
   * undoing it clears eligibility (older actions stay superseded).
   */
  async loadControlUndoContext(tenantId: string): Promise<{
    undoneMap: Map<string, { undoActionId: string; undoneAt: string }>;
    latestEligibleByAgent: Map<AgentId, string | null>;
  }> {
    const controlLogs = await this.prisma.auditLog.findMany({
      where: {
        tenantId,
        action: { in: [...CONTROL_TIMELINE_ACTIONS] },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 2000,
    });

    const computed = computeLatestEligibleControlActions(
      controlLogs.map(row => ({
        id: row.id,
        action: row.action,
        after: (row.after as Record<string, unknown> | null) || null,
      })),
    );

    const undoneMap = new Map<string, { undoActionId: string; undoneAt: string }>();
    const undoTimes = new Map(
      controlLogs
        .filter(r => r.action === 'agent_control_undo')
        .map(r => [r.id, r.createdAt.toISOString()] as const),
    );
    for (const [actionId, undoActionId] of computed.undoneOf) {
      undoneMap.set(actionId, {
        undoActionId,
        undoneAt: undoTimes.get(undoActionId) ?? new Date(0).toISOString(),
      });
    }

    const latestEligibleByAgent = new Map<AgentId, string | null>();
    for (const [agentId, latestId] of computed.latestEligibleByAgent) {
      if (isAgentId(agentId)) latestEligibleByAgent.set(agentId, latestId);
    }

    return { undoneMap, latestEligibleByAgent };
  }

  normalizeAuditToAction(
    log: AuditLog,
    undoneMap: Map<string, { undoActionId: string; undoneAt: string }>,
    latestEligibleByAgent: Map<AgentId, string | null> = new Map(),
  ): AgentAction | null {
    const afterRaw = (log.after as Record<string, unknown> | null) || null;
    const beforeRaw = (log.before as Record<string, unknown> | null) || null;
    const after = afterRaw
      ? (redactSecrets(boundJson(afterRaw) || {}) as Record<string, unknown>)
      : null;
    const before = beforeRaw
      ? (redactSecrets(boundJson(beforeRaw) || {}) as Record<string, unknown>)
      : null;

    const agentId = mapAuditActionToAgentId(log.action, afterRaw);
    // Unmapped audit rows must not be falsely attributed
    if (!agentId && !log.action.startsWith('agent_control_')) {
      if (!log.action.startsWith('research_') && !log.action.startsWith('sdr_')) {
        return null;
      }
      return null;
    }

    const reversible = isDomainActionReversible(log.action) && afterRaw?.reversible === true;
    const undoRecord = undoneMap.get(log.id);
    let undoStatus: AgentAction['undo']['status'] = 'not_reversible';
    if (reversible) {
      if (undoRecord) {
        undoStatus = 'undone';
      } else if (agentId && (latestEligibleByAgent.get(agentId) ?? null) === log.id) {
        undoStatus = 'available';
      } else {
        undoStatus = 'superseded';
      }
    }

    const confidence = this.extractConfidence(log.action, afterRaw);

    return {
      id: log.id,
      agentId,
      actionType: log.action,
      status: actionStatusFromAudit(log.action, log.success),
      occurredAt: log.createdAt.toISOString(),
      updatedAt: log.createdAt.toISOString(),
      subject: {
        resourceType: log.resourceType,
        resourceId: log.resourceTwentyId,
        summary: log.message,
      },
      evidenceSummary: this.buildEvidenceSummary(log.action, after),
      confidence,
      permissionKey: permissionKeyForAction(log.action, agentId),
      approvalState: deriveApprovalState(log.action, afterRaw),
      triggeredBy: log.triggeredBy,
      mutationSummary: {
        before,
        after,
        success: log.success,
        message: log.message,
      },
      reversible,
      undo: {
        status: undoStatus,
        undoneByActionId: undoRecord?.undoActionId ?? null,
        undoneAt: undoRecord?.undoneAt ?? null,
      },
      auditLogId: log.id,
    };
  }

  private extractConfidence(
    action: string,
    after: Record<string, unknown> | null,
  ): ConfidenceValue {
    if (!after) return 'not_applicable';
    if (typeof after.confidence === 'number') return after.confidence;
    if (action.startsWith('agent_control_')) return 'not_applicable';
    if (action.includes('blocked') || action.includes('reply_received')) return 'not_applicable';
    return 'not_applicable';
  }

  private buildEvidenceSummary(
    action: string,
    after: Record<string, unknown> | null,
  ): AgentAction['evidenceSummary'] {
    if (!after) return [];
    const items: AgentAction['evidenceSummary'] = [];

    if (typeof after.whyNow === 'string') {
      items.push({ label: 'Why-Now', text: after.whyNow.slice(0, 400), whyNow: after.whyNow });
    }
    if (typeof after.contentHash === 'string') {
      items.push({
        label: 'Draft hash',
        text: after.contentHash.slice(0, 64),
        contentHash: after.contentHash,
        draftVersion: typeof after.version === 'number' ? after.version : null,
      });
    }
    if (typeof after.classification === 'string') {
      items.push({
        label: 'Reply classification',
        text: after.classification,
        replyClassification: after.classification,
      });
    }
    if (typeof after.bookingLink === 'string') {
      items.push({
        label: 'Meeting',
        text: 'Booking proposed',
        meetingStatus: 'PROPOSED',
      });
    }
    if (typeof after.providerMeetingId === 'string') {
      items.push({
        label: 'Meeting',
        text: 'Booked',
        meetingStatus: 'BOOKED',
      });
    }
    if (Array.isArray(after.doNotClaim)) {
      items.push({
        label: 'doNotClaim',
        text: (after.doNotClaim as string[]).slice(0, 5).join('; ').slice(0, 400),
        doNotClaim: (after.doNotClaim as string[]).slice(0, 10).map(String),
      });
    }
    if (typeof after.findingCount === 'number') {
      items.push({
        label: 'Findings',
        text: `${after.findingCount} findings`,
      });
    }
    if (action.includes('finding') && typeof after.title === 'string') {
      items.push({
        label: 'Finding',
        text: after.title.slice(0, 300),
        sourceUrl: typeof after.sourceUrl === 'string' ? after.sourceUrl : null,
        sourceTitle: typeof after.sourceTitle === 'string' ? after.sourceTitle : null,
        evidenceType: typeof after.evidenceType === 'string' ? after.evidenceType : null,
        findingId: typeof after.id === 'string' ? after.id : null,
      });
    }

    if (items.length === 0 && after.state) {
      items.push({
        label: 'State',
        text: String(after.state),
      });
    }

    return items.slice(0, 8);
  }
}
