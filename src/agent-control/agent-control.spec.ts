import {
  deriveApprovalState,
  isControlMutationReversible,
  isDomainActionReversible,
  mapAuditActionToAgentId,
  permissionKeyForAction,
  computeLatestEligibleControlActions,
} from './agent-action-mapper';
import { getAgentDefinition, listAgentDefinitions } from './agent-registry';
import { AGENT_CONTROL_VERSION, boundJson, isAgentId } from './agent-control.types';

describe('agent-control registry + mapper (ZEX-39)', () => {
  it('exposes research_agent and ai_sdr only', () => {
    const ids = listAgentDefinitions().map(a => a.id);
    expect(ids).toEqual(['research_agent', 'ai_sdr']);
    expect(isAgentId('research_agent')).toBe(true);
    expect(isAgentId('meeting_agent')).toBe(false);
  });

  it('represents research permissions accurately', () => {
    const perms = getAgentDefinition('research_agent').permissions;
    expect(perms.find(p => p.key === 'research_accounts')?.mode).toBe('allowed');
    expect(perms.find(p => p.key === 'write_research_findings')?.mode).toBe('allowed');
    expect(perms.find(p => p.key === 'mutate_crm')?.mode).toBe('not_allowed');
    expect(perms.find(p => p.key === 'send_outreach')?.mode).toBe('not_allowed');
  });

  it('represents AI SDR permissions and approval policy', () => {
    const def = getAgentDefinition('ai_sdr');
    expect(def.permissions.find(p => p.key === 'draft_outreach')?.mode).toBe('allowed');
    expect(def.permissions.find(p => p.key === 'approve_draft')?.mode).toBe('human_only');
    expect(def.permissions.find(p => p.key === 'send_outreach')?.mode).toBe('approval_required');
    expect(def.permissions.find(p => p.key === 'auto_send')?.mode).toBe('not_allowed');
    expect(def.approvalPolicy.neverAutonomous).toContain('email_send_without_approval');
  });

  it('maps known audit actions to agents and leaves unknown unmapped', () => {
    expect(mapAuditActionToAgentId('research_completed')).toBe('research_agent');
    expect(mapAuditActionToAgentId('sdr_sent')).toBe('ai_sdr');
    expect(mapAuditActionToAgentId('agent_control_paused', { agentId: 'ai_sdr' })).toBe('ai_sdr');
    expect(mapAuditActionToAgentId('company_brain_created')).toBeNull();
    expect(mapAuditActionToAgentId('research_unknown_future_event')).toBeNull();
    expect(mapAuditActionToAgentId('sdr_unknown_future_event')).toBeNull();
    expect(mapAuditActionToAgentId('enrich_and_score_person')).toBeNull();
  });

  it('marks only pause/resume as reversible domain actions', () => {
    expect(isControlMutationReversible('agent_control_paused')).toBe(true);
    expect(isControlMutationReversible('agent_control_resumed')).toBe(true);
    expect(isDomainActionReversible('sdr_sent')).toBe(false);
    expect(isDomainActionReversible('sdr_meeting_booked')).toBe(false);
    expect(isDomainActionReversible('research_completed')).toBe(false);
  });

  it('derives approval states from SDR actions', () => {
    expect(deriveApprovalState('sdr_draft_generated')).toBe('awaiting_approval');
    expect(deriveApprovalState('sdr_approval_granted')).toBe('approved');
    expect(deriveApprovalState('sdr_draft_rejected')).toBe('rejected');
    expect(deriveApprovalState('sdr_draft_superseded')).toBe('superseded');
    expect(deriveApprovalState('sdr_meeting_booking_started')).toBe(
      'meeting_awaiting_confirmation',
    );
  });

  it('maps permission keys for actions', () => {
    expect(permissionKeyForAction('research_started', 'research_agent')).toBe('research_accounts');
    expect(permissionKeyForAction('sdr_sent', 'ai_sdr')).toBe('send_outreach');
    expect(permissionKeyForAction('sdr_approval_granted', 'ai_sdr')).toBe('approve_draft');
  });

  it('computes latest-effective control eligibility conservatively', () => {
    const timeline = [
      { id: 'A', action: 'agent_control_paused', after: { agentId: 'research_agent' } },
      { id: 'B', action: 'agent_control_resumed', after: { agentId: 'research_agent' } },
      { id: 'C', action: 'agent_control_paused', after: { agentId: 'research_agent' } },
    ];
    let computed = computeLatestEligibleControlActions(timeline);
    expect(computed.latestEligibleByAgent.get('research_agent')).toBe('C');

    computed = computeLatestEligibleControlActions([
      ...timeline,
      {
        id: 'U',
        action: 'agent_control_undo',
        after: { agentId: 'research_agent', undoOf: 'C' },
      },
    ]);
    expect(computed.latestEligibleByAgent.get('research_agent')).toBeNull();
    expect(computed.undoneOf.get('C')).toBe('U');
  });

  it('bounds JSON and keeps version constant', () => {
    expect(AGENT_CONTROL_VERSION).toBe('agent-control-v1');
    const big = { a: 'x'.repeat(2000), nested: { secret: 'nope' } };
    const bounded = boundJson(big, 2, 10, 50);
    expect(String(bounded?.a).length).toBeLessThanOrEqual(50);
  });
});

describe('agent-control service helpers', () => {
  it('normalizeAuditToAction skips unmapped audits', async () => {
    const { AgentControlService } = await import('./agent-control.service');
    const service = new AgentControlService({} as never, { log: jest.fn() } as never);
    const action = service.normalizeAuditToAction(
      {
        id: 'a1',
        tenantId: 't1',
        action: 'company_brain_created',
        resourceType: 'CompanyBrain',
        resourceTwentyId: 'b1',
        before: null,
        after: { name: 'x' },
        triggeredBy: 'admin',
        webhookLogId: null,
        success: true,
        message: null,
        createdAt: new Date('2026-09-05T00:00:00.000Z'),
      },
      new Map(),
    );
    expect(action).toBeNull();
  });

  it('marks pause audit as reversible and available only when latest-eligible', async () => {
    const { AgentControlService } = await import('./agent-control.service');
    const service = new AgentControlService({} as never, { log: jest.fn() } as never);
    const latest = new Map([['research_agent' as const, 'pause1']]);
    const action = service.normalizeAuditToAction(
      {
        id: 'pause1',
        tenantId: 't1',
        action: 'agent_control_paused',
        resourceType: 'TenantAgentControl',
        resourceTwentyId: 'c1',
        before: { agentId: 'research_agent', state: 'ACTIVE' },
        after: { agentId: 'research_agent', state: 'PAUSED', reversible: true },
        triggeredBy: 'admin',
        webhookLogId: null,
        success: true,
        message: null,
        createdAt: new Date('2026-09-05T00:00:00.000Z'),
      },
      new Map(),
      latest,
    );
    expect(action?.agentId).toBe('research_agent');
    expect(action?.reversible).toBe(true);
    expect(action?.undo.status).toBe('available');
    expect(action?.confidence).toBe('not_applicable');
  });

  it('marks older pause as superseded when a newer control mutation is eligible', async () => {
    const { AgentControlService } = await import('./agent-control.service');
    const service = new AgentControlService({} as never, { log: jest.fn() } as never);
    const latest = new Map([['research_agent' as const, 'pauseC']]);
    const action = service.normalizeAuditToAction(
      {
        id: 'pauseA',
        tenantId: 't1',
        action: 'agent_control_paused',
        resourceType: 'TenantAgentControl',
        resourceTwentyId: 'c1',
        before: { agentId: 'research_agent', state: 'ACTIVE' },
        after: { agentId: 'research_agent', state: 'PAUSED', reversible: true },
        triggeredBy: 'admin',
        webhookLogId: null,
        success: true,
        message: null,
        createdAt: new Date('2026-09-05T00:00:00.000Z'),
      },
      new Map(),
      latest,
    );
    expect(action?.reversible).toBe(true);
    expect(action?.undo.status).toBe('superseded');
  });

  it('marks undone pause as undone even if not latest-eligible', async () => {
    const { AgentControlService } = await import('./agent-control.service');
    const service = new AgentControlService({} as never, { log: jest.fn() } as never);
    const undone = new Map([
      ['pauseC', { undoActionId: 'undo1', undoneAt: '2026-09-05T01:00:00.000Z' }],
    ]);
    const action = service.normalizeAuditToAction(
      {
        id: 'pauseC',
        tenantId: 't1',
        action: 'agent_control_paused',
        resourceType: 'TenantAgentControl',
        resourceTwentyId: 'c1',
        before: { agentId: 'research_agent', state: 'ACTIVE' },
        after: { agentId: 'research_agent', state: 'PAUSED', reversible: true },
        triggeredBy: 'admin',
        webhookLogId: null,
        success: true,
        message: null,
        createdAt: new Date('2026-09-05T00:30:00.000Z'),
      },
      undone,
      new Map([['research_agent' as const, null]]),
    );
    expect(action?.undo.status).toBe('undone');
    expect(action?.undo.undoneByActionId).toBe('undo1');
  });

  it('never fabricates confidence for send audits without confidence field', async () => {
    const { AgentControlService } = await import('./agent-control.service');
    const service = new AgentControlService({} as never, { log: jest.fn() } as never);
    const action = service.normalizeAuditToAction(
      {
        id: 'send1',
        tenantId: 't1',
        action: 'sdr_sent',
        resourceType: 'SdrMessage',
        resourceTwentyId: 'm1',
        before: null,
        after: { draftId: 'd1', contentHash: 'abc' },
        triggeredBy: 'admin',
        webhookLogId: null,
        success: true,
        message: null,
        createdAt: new Date('2026-09-05T00:00:00.000Z'),
      },
      new Map(),
    );
    expect(action?.agentId).toBe('ai_sdr');
    expect(action?.reversible).toBe(false);
    expect(action?.confidence).toBe('not_applicable');
    expect(action?.approvalState).toBe('sent');
  });
});
