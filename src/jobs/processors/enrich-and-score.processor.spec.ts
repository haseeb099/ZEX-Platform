import { Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { EnrichAndScoreProcessor } from './enrich-and-score.processor';

describe('EnrichAndScoreProcessor CRM failure semantics', () => {
  const tenantId = 'tenant_1';
  const personTwentyId = 'person_1';
  const webhookLogId = 'log_1';

  function buildProcessor(overrides?: {
    allowSnapshotFallback?: boolean;
    twenty?: Partial<{
      getPerson: jest.Mock;
      updatePerson: jest.Mock;
      createNote: jest.Mock;
      createOpportunity: jest.Mock;
    }>;
    enableAutoOpportunity?: boolean;
    opportunityThreshold?: number;
  }) {
    const prisma = {
      webhookLog: {
        update: jest.fn().mockResolvedValue({}),
      },
      tenant: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: tenantId,
          enableAutoOpportunity: overrides?.enableAutoOpportunity ?? true,
          opportunityThreshold: overrides?.opportunityThreshold ?? 50,
        }),
      },
      scoreHistory: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const enrichment = {
      enrichPerson: jest.fn().mockResolvedValue({
        jobTitle: 'VP Engineering',
        companyName: 'Acme',
        location: 'London',
        personEmail: 'ada@acme.test',
        industry: 'SaaS',
        companySize: '51-200',
        source: 'test',
        confidence: 100,
      }),
    };

    const scoring = {
      score: jest.fn().mockResolvedValue({
        score: 80,
        factors: { titleMatch: 25 },
        ruleName: 'test-rule',
      }),
    };

    const twenty = {
      getPerson: jest.fn().mockResolvedValue({
        id: personTwentyId,
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@acme.test',
        jobTitle: 'Engineer',
      }),
      updatePerson: jest.fn().mockResolvedValue({ id: personTwentyId, jobTitle: 'VP Engineering' }),
      createNote: jest.fn().mockResolvedValue({ id: 'note_1' }),
      createOpportunity: jest
        .fn()
        .mockResolvedValue({ id: 'opp_real_1', name: 'Ada - Auto-qualified' }),
      ...overrides?.twenty,
    };

    const audit = {
      log: jest.fn().mockResolvedValue({}),
    };

    const logger = {
      warn: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    };

    const config = {
      get: (key: string) => {
        if (key === 'ALLOW_TWENTY_SNAPSHOT_FALLBACK') {
          return overrides?.allowSnapshotFallback === true;
        }
        return undefined;
      },
    } as ConfigService;

    const processor = new EnrichAndScoreProcessor(
      prisma as never,
      enrichment as never,
      scoring as never,
      twenty as never,
      audit as never,
      logger as never,
      config,
    );

    const job = {
      name: 'enrich-and-score-person',
      attemptsMade: 0,
      data: {
        tenantId,
        personTwentyId,
        webhookLogId,
        event: 'person.created',
        personSnapshot: {
          id: personTwentyId,
          firstName: 'Snap',
          lastName: 'Shot',
          email: 'snap@test.com',
          jobTitle: 'Intern',
        },
      },
    } as Job;

    return { processor, prisma, enrichment, scoring, twenty, audit, logger, job };
  }

  beforeEach(() => {
    process.env.FEATURE_AUTO_OPPORTUNITY = 'true';
  });

  it('propagates GetPerson CRM failure by default (no silent snapshot fallback)', async () => {
    const { processor, twenty, audit, job, prisma } = buildProcessor({
      twenty: {
        getPerson: jest.fn().mockRejectedValue(new Error('crm read down')),
      },
    });

    await expect(processor.process(job)).rejects.toThrow('crm read down');
    expect(audit.log).not.toHaveBeenCalled();
    expect(prisma.scoreHistory.create).not.toHaveBeenCalled();
    expect(prisma.webhookLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      }),
    );
    expect(twenty.updatePerson).not.toHaveBeenCalled();
  });

  it('uses webhook snapshot only when ALLOW_TWENTY_SNAPSHOT_FALLBACK=true', async () => {
    const { processor, twenty, audit, job } = buildProcessor({
      allowSnapshotFallback: true,
      twenty: {
        getPerson: jest.fn().mockRejectedValue(new Error('crm read down')),
      },
    });

    await expect(processor.process(job)).resolves.toMatchObject({ opportunityCreated: true });
    expect(twenty.updatePerson).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('propagates UpdatePerson failure without success audit or opportunity', async () => {
    const { processor, twenty, audit, prisma, job } = buildProcessor({
      twenty: {
        updatePerson: jest.fn().mockRejectedValue(new Error('update failed')),
      },
    });

    await expect(processor.process(job)).rejects.toThrow('update failed');
    expect(twenty.createNote).not.toHaveBeenCalled();
    expect(twenty.createOpportunity).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
    expect(prisma.scoreHistory.create).not.toHaveBeenCalled();
    expect(prisma.webhookLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed', error: 'update failed' }),
      }),
    );
  });

  it('propagates CreateNote failure without success audit', async () => {
    const { processor, twenty, audit, job } = buildProcessor({
      twenty: {
        createNote: jest.fn().mockRejectedValue(new Error('note failed')),
      },
    });

    await expect(processor.process(job)).rejects.toThrow('note failed');
    expect(twenty.createOpportunity).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('propagates CreateOpportunity failure and never sets opportunityCreated=true or pending ids', async () => {
    const { processor, twenty, audit, prisma, job } = buildProcessor({
      twenty: {
        createOpportunity: jest.fn().mockRejectedValue(new Error('opp failed')),
      },
    });

    await expect(processor.process(job)).rejects.toThrow('opp failed');
    expect(twenty.createOpportunity).toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
    expect(prisma.scoreHistory.create).not.toHaveBeenCalled();

    const failedUpdate = prisma.webhookLog.update.mock.calls.find(
      (c: [{ data?: { status?: string; error?: string } }]) => c[0]?.data?.status === 'failed',
    );
    expect(failedUpdate?.[0]?.data?.error).toBe('opp failed');
    expect(JSON.stringify(prisma.scoreHistory.create.mock.calls)).not.toContain('pending-twenty-');
  });

  it('writes success audit only after required CRM writes succeed with a real opportunity id', async () => {
    const { processor, audit, prisma, job } = buildProcessor();

    const result = await processor.process(job);
    expect(result).toEqual({
      score: 80,
      factors: { titleMatch: 25 },
      opportunityCreated: true,
    });
    expect(prisma.scoreHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          opportunityCreated: true,
          opportunityTwentyId: 'opp_real_1',
        }),
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(JSON.stringify(prisma.scoreHistory.create.mock.calls)).not.toContain('pending-twenty-');
  });
});
