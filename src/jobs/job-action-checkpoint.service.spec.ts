import { CRM_WRITE_ACTIONS, JobActionCheckpointService } from './job-action-checkpoint.service';

describe('JobActionCheckpointService', () => {
  const tenantId = 'tenant_a';
  const tenantB = 'tenant_b';
  const webhookLogId = 'log_1';
  const webhookLogB = 'log_b';
  const personId = 'person_1';

  function buildService(store = new Map<string, { status: string; externalId?: string }>()) {
    const key = (t: string, w: string, a: string) => `${t}:${w}:${a}`;
    const prisma = {
      jobActionCheckpoint: {
        findUnique: jest.fn(
          async ({
            where,
          }: {
            where: {
              tenantId_webhookLogId_action: {
                tenantId: string;
                webhookLogId: string;
                action: string;
              };
            };
          }) => {
            const k = key(
              where.tenantId_webhookLogId_action.tenantId,
              where.tenantId_webhookLogId_action.webhookLogId,
              where.tenantId_webhookLogId_action.action,
            );
            const row = store.get(k);
            return row ? { status: row.status, externalId: row.externalId ?? null } : null;
          },
        ),
        upsert: jest.fn(
          async ({
            where,
            create,
            update,
          }: {
            where: {
              tenantId_webhookLogId_action: {
                tenantId: string;
                webhookLogId: string;
                action: string;
              };
            };
            create: { externalId?: string };
            update: { externalId?: string };
          }) => {
            const k = key(
              where.tenantId_webhookLogId_action.tenantId,
              where.tenantId_webhookLogId_action.webhookLogId,
              where.tenantId_webhookLogId_action.action,
            );
            store.set(k, {
              status: 'completed',
              externalId: update.externalId ?? create.externalId,
            });
          },
        ),
      },
    };

    return { service: new JobActionCheckpointService(prisma as never), store, prisma };
  }

  it('returns pending when no checkpoint exists', async () => {
    const { service } = buildService();
    await expect(
      service.getCompleted(tenantId, webhookLogId, CRM_WRITE_ACTIONS.UPDATE_PERSON),
    ).resolves.toEqual({ completed: false });
  });

  it('records and reads completed checkpoints scoped to tenant + webhookLogId', async () => {
    const { service } = buildService();
    await service.recordSuccess(
      tenantId,
      webhookLogId,
      personId,
      CRM_WRITE_ACTIONS.CREATE_OPPORTUNITY,
      'opp_1',
    );

    await expect(
      service.getCompleted(tenantId, webhookLogId, CRM_WRITE_ACTIONS.CREATE_OPPORTUNITY),
    ).resolves.toEqual({ completed: true, externalId: 'opp_1' });
  });

  it('does not cross tenants or webhook events', async () => {
    const { service, store } = buildService();
    await service.recordSuccess(tenantId, webhookLogId, personId, CRM_WRITE_ACTIONS.CREATE_NOTE);

    await expect(
      service.getCompleted(tenantB, webhookLogId, CRM_WRITE_ACTIONS.CREATE_NOTE),
    ).resolves.toEqual({ completed: false });
    await expect(
      service.getCompleted(tenantId, webhookLogB, CRM_WRITE_ACTIONS.CREATE_NOTE),
    ).resolves.toEqual({ completed: false });

    expect(store.has(`${tenantId}:${webhookLogId}:create_note`)).toBe(true);
    expect(store.has(`${tenantB}:${webhookLogId}:create_note`)).toBe(false);
  });
});
