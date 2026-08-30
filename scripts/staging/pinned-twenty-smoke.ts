/**
 * Pinned Twenty staging smoke — requires a running ZEX-CRM/Twenty + ZEX-Platform stack.
 * NOT part of normal CI. See docs/STAGING_RUNBOOK.md
 */
import { createHmac, randomBytes } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { GraphQLClient, gql } from 'graphql-request';
import { loadStagingEnv, optionalStagingEnv } from './staging-env';

const prisma = new PrismaClient();

function log(step: string, detail?: string) {
  // eslint-disable-next-line no-console
  console.log(detail ? `[staging] ${step}: ${detail}` : `[staging] ${step}`);
}

function signTwentyWebhook(rawBody: string, secret: string, timestamp: string): string {
  return createHmac('sha256', secret).update(`${timestamp}:${rawBody}`, 'utf8').digest('hex');
}

async function sleep(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor<T>(
  label: string,
  fn: () => Promise<T | null | undefined | false>,
  timeoutMs = 120_000,
): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await fn();
    if (result) return result;
    await sleep(1000);
  }
  throw new Error(`Timeout waiting for ${label}`);
}

async function probeGraphql(env: ReturnType<typeof loadStagingEnv>, personId: string) {
  const client = new GraphQLClient(env.STAGING_TWENTY_GRAPHQL_URL, {
    headers: { Authorization: `Bearer ${env.STAGING_TWENTY_API_KEY}` },
  });

  log('GraphQL probe', 'GetPerson');
  await client.request(
    gql`
      query StagingGetPerson($filter: PersonFilterInput!) {
        person(filter: $filter) {
          id
          name {
            firstName
            lastName
          }
          emails {
            primaryEmail
          }
          jobTitle
        }
      }
    `,
    { filter: { id: { eq: personId } } },
  );

  log('GraphQL probe', 'UpdatePerson (no-op jobTitle touch)');
  await client.request(
    gql`
      mutation StagingUpdatePerson($personId: UUID!, $data: PersonUpdateInput!) {
        updatePerson(id: $personId, data: $data) {
          id
          jobTitle
        }
      }
    `,
    { personId, data: { jobTitle: 'Engineer' } },
  );

  log('GraphQL probe', 'CreateNote + CreateNoteTarget');
  const note = await client.request<{ createNote: { id: string } }>(
    gql`
      mutation StagingCreateNote($data: NoteCreateInput!) {
        createNote(data: $data) {
          id
        }
      }
    `,
    {
      data: {
        title: 'ZEX Staging Probe',
        bodyV2: { markdown: 'probe note — safe to delete', blocknote: null },
      },
    },
  );

  await client.request(
    gql`
      mutation StagingCreateNoteTarget($data: NoteTargetCreateInput!) {
        createNoteTarget(data: $data) {
          id
        }
      }
    `,
    { data: { noteId: note.createNote.id, targetPersonId: personId } },
  );

  log('GraphQL probe', 'CreateOpportunity');
  const opp = await client.request<{ createOpportunity: { id: string } }>(
    gql`
      mutation StagingCreateOpportunity($data: OpportunityCreateInput!) {
        createOpportunity(data: $data) {
          id
          name
          stage
        }
      }
    `,
    {
      data: {
        name: 'ZEX Staging Probe Opportunity',
        pointOfContactId: personId,
        stage: 'NEW',
      },
    },
  );

  return { probeNoteId: note.createNote.id, probeOppId: opp.createOpportunity.id };
}

async function createStagingPerson(env: ReturnType<typeof loadStagingEnv>) {
  const client = new GraphQLClient(env.STAGING_TWENTY_GRAPHQL_URL, {
    headers: { Authorization: `Bearer ${env.STAGING_TWENTY_API_KEY}` },
  });

  const suffix = Date.now().toString(36);
  const result = await client.request<{ createPerson: { id: string } }>(
    gql`
      mutation StagingCreatePerson($data: PersonCreateInput!) {
        createPerson(data: $data) {
          id
          name {
            firstName
            lastName
          }
          emails {
            primaryEmail
          }
          jobTitle
        }
      }
    `,
    {
      data: {
        name: { firstName: 'ZEX', lastName: 'Staging Test' },
        emails: {
          primaryEmail: `zex-staging-test-${suffix}@example.invalid`,
          additionalEmails: [],
        },
        jobTitle: 'Engineer',
      },
    },
  );

  return result.createPerson.id;
}

async function provisionPlatformTenant(env: ReturnType<typeof loadStagingEnv>) {
  const suffix = Date.now().toString(36);
  const webhookSecret = env.STAGING_TWENTY_WEBHOOK_SECRET;
  const response = await fetch(`${env.STAGING_PLATFORM_BASE_URL}/api/v1/admin/tenants`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.STAGING_PLATFORM_ADMIN_API_KEY}`,
    },
    body: JSON.stringify({
      name: `ZEX Staging ${suffix}`,
      workspaceId: env.STAGING_TWENTY_WORKSPACE_ID,
      baseUrl: env.STAGING_TWENTY_BASE_URL,
      graphqlUrl: env.STAGING_TWENTY_GRAPHQL_URL,
      restUrl: env.STAGING_TWENTY_REST_URL,
      apiKey: env.STAGING_TWENTY_API_KEY,
      webhookSecret,
      publicBaseUrl: env.STAGING_PLATFORM_BASE_URL,
    }),
  });

  if (!response.ok) {
    throw new Error(`Tenant provisioning failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as Record<string, unknown>;
  const serialized = JSON.stringify(body);
  if (
    serialized.includes(env.STAGING_TWENTY_API_KEY) ||
    serialized.includes(webhookSecret)
  ) {
    throw new Error('Tenant provisioning response leaked secrets');
  }

  return body as { tenantId: string; slug: string; webhookUrl: string };
}

function buildPinnedWebhookPayload(personId: string, workspaceId: string) {
  return {
    targetUrl: 'placeholder',
    eventName: 'person.created',
    objectMetadata: { id: 'staging-object-metadata', nameSingular: 'person' },
    workspaceId,
    webhookId: `staging-${randomBytes(8).toString('hex')}`,
    eventDate: new Date().toISOString(),
    record: {
      id: personId,
      name: { firstName: 'ZEX', lastName: 'Staging Test' },
      emails: { primaryEmail: 'zex-staging-test@example.invalid' },
      jobTitle: 'Engineer',
    },
  };
}

async function submitSignedWebhook(
  env: ReturnType<typeof loadStagingEnv>,
  tenantId: string,
  payload: object,
  nonce: string,
) {
  const rawBody = JSON.stringify(payload);
  const timestamp = Date.now().toString();
  const signature = signTwentyWebhook(rawBody, env.STAGING_TWENTY_WEBHOOK_SECRET, timestamp);

  const response = await fetch(`${env.STAGING_PLATFORM_BASE_URL}/webhooks/twenty/${tenantId}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-twenty-webhook-signature': signature,
      'x-twenty-webhook-timestamp': timestamp,
      'x-twenty-webhook-nonce': nonce,
    },
    body: rawBody,
  });

  if (!response.ok) {
    throw new Error(`Webhook POST failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function main() {
  const env = loadStagingEnv();
  process.env.STAGING_DETERMINISTIC_ENRICHMENT = 'true';

  log('start', `Twenty GraphQL ${env.STAGING_TWENTY_GRAPHQL_URL}`);
  log('start', `Platform ${env.STAGING_PLATFORM_BASE_URL}`);

  const personId = optionalStagingEnv('STAGING_TWENTY_PERSON_ID') || (await createStagingPerson(env));
  log('person', personId);

  await probeGraphql(env, personId);

  const tenant = await provisionPlatformTenant(env);
  log('tenant', tenant.tenantId);

  const nonce = `staging-smoke-${Date.now()}`;
  const payload = buildPinnedWebhookPayload(personId, env.STAGING_TWENTY_WORKSPACE_ID);
  await submitSignedWebhook(env, tenant.tenantId, payload, nonce);
  log('webhook', 'submitted signed person.created payload');

  const webhookLog = await waitFor('WebhookLog success', async () => {
    const row = await prisma.webhookLog.findFirst({
      where: { tenantId: tenant.tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return row?.status === 'success' ? row : null;
  });

  log('platform', `WebhookLog ${webhookLog.id} success`);

  const checkpoints = await prisma.jobActionCheckpoint.findMany({
    where: { tenantId: tenant.tenantId, webhookLogId: webhookLog.id },
  });
  log('platform', `checkpoints=${checkpoints.length}`);

  const audit = await prisma.auditLog.findFirst({
    where: {
      tenantId: tenant.tenantId,
      webhookLogId: webhookLog.id,
      success: true,
    },
  });
  if (!audit) throw new Error('Missing success AuditLog');

  const twenty = new GraphQLClient(env.STAGING_TWENTY_GRAPHQL_URL, {
    headers: { Authorization: `Bearer ${env.STAGING_TWENTY_API_KEY}` },
  });
  const personAfter = await twenty.request<{ person: { jobTitle?: string | null } }>(
    gql`
      query StagingVerifyPerson($filter: PersonFilterInput!) {
        person(filter: $filter) {
          jobTitle
        }
      }
    `,
    { filter: { id: { eq: personId } } },
  );

  if (personAfter.person?.jobTitle !== 'VP Engineering') {
    throw new Error(
      `Expected jobTitle VP Engineering after worker, got ${personAfter.person?.jobTitle}`,
    );
  }

  log('result', 'PASS — pinned Twenty staging smoke completed');
  log(
    'limitations',
    'Real Twenty→Platform webhook network delivery not exercised unless STAGING_USE_REAL_WEBHOOK_DELIVERY=true (requires OUTBOUND_HTTP_SAFE_MODE disabled). This run used a signed payload matching observed Twenty shape.',
  );

  await prisma.$disconnect();
}

main().catch(async err => {
  // eslint-disable-next-line no-console
  console.error('[staging] FAIL', err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
