/**
 * Post-smoke verification + wrong-secret security check (local staging only).
 */
const fs = require('fs');
const { createHmac } = require('crypto');
const { GraphQLClient, gql } = require('graphql-request');
const { PrismaClient } = require('@prisma/client');

function loadEnv(path) {
  const env = {};
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

function sign(rawBody, secret, timestamp) {
  return createHmac('sha256', secret).update(`${timestamp}:${rawBody}`, 'utf8').digest('hex');
}

async function main() {
  const env = loadEnv('E:/Z Connect/.env.staging.local');
  const prisma = new PrismaClient();
  const tenant = await prisma.tenant.findFirst({ orderBy: { createdAt: 'desc' } });
  if (!tenant) throw new Error('No staging tenant');

  const wl = await prisma.webhookLog.findFirst({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: 'desc' },
  });
  const checkpoints = await prisma.jobActionCheckpoint.findMany({
    where: { tenantId: tenant.id, webhookLogId: wl.id },
  });
  const audit = await prisma.auditLog.findFirst({
    where: { tenantId: tenant.id, webhookLogId: wl.id, success: true },
  });
  const score = await prisma.scoreHistory.findFirst({
    where: { tenantId: tenant.id, personTwentyId: env.STAGING_TWENTY_PERSON_ID },
    orderBy: { createdAt: 'desc' },
  });

  console.log('[verify] tenant', tenant.id);
  console.log('[verify] webhookLog', wl?.status, wl?.id);
  console.log('[verify] checkpoints', checkpoints.map((c) => c.action).join(','));
  console.log('[verify] audit', audit?.success, audit?.action);
  console.log('[verify] score', score?.score, 'opportunityCreated', score?.opportunityCreated, 'oppId', score?.opportunityTwentyId);

  const personId = env.STAGING_TWENTY_PERSON_ID;
  const client = new GraphQLClient(env.STAGING_TWENTY_GRAPHQL_URL, {
    headers: { Authorization: `Bearer ${env.STAGING_TWENTY_API_KEY}` },
  });

  const person = await client.request(
    gql`query($filter: PersonFilterInput!) { person(filter: $filter) { id jobTitle } }`,
    { filter: { id: { eq: personId } } },
  );
  console.log('[verify] person.jobTitle', person.person?.jobTitle);

  const notes = await client.request(
    gql`query {
      notes(first: 50, orderBy: { createdAt: DescNullsLast }) {
        edges { node { id title bodyV2 { markdown } } }
      }
    }`,
  );
  const zexNotes =
    notes.notes?.edges?.filter((e) =>
      /ZEX|automation|staging/i.test(e.node?.title || e.node?.bodyV2?.markdown || ''),
    ) ?? [];
  console.log('[verify] zex-like notes (sample)', zexNotes.length);

  const opps = await client.request(
    gql`query($filter: OpportunityFilterInput!) {
      opportunities(filter: $filter, first: 20) {
        edges { node { id name stage pointOfContactId } }
      }
    }`,
    { filter: { pointOfContactId: { eq: personId } } },
  );
  const oppCount = opps.opportunities?.edges?.length ?? 0;
  console.log('[verify] opportunities for person', oppCount);

  const payload = {
    eventName: 'person.created',
    workspaceId: env.STAGING_TWENTY_WORKSPACE_ID,
    webhookId: 'wrong-secret-test',
    eventDate: new Date().toISOString(),
    record: { id: personId, name: { firstName: 'ZEX', lastName: 'Staging Test' } },
  };
  const rawBody = JSON.stringify(payload);
  const timestamp = Date.now().toString();
  const badSig = sign(rawBody, 'wrong-secret-value', timestamp);
  const beforeJobs = await prisma.webhookLog.count({ where: { tenantId: tenant.id } });

  const badRes = await fetch(`${env.STAGING_PLATFORM_BASE_URL}/webhooks/twenty/${tenant.id}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-twenty-webhook-signature': badSig,
      'x-twenty-webhook-timestamp': timestamp,
      'x-twenty-webhook-nonce': `wrong-secret-${Date.now()}`,
    },
    body: rawBody,
  });
  const afterJobs = await prisma.webhookLog.count({ where: { tenantId: tenant.id } });
  console.log('[verify] wrong-secret status', badRes.status, 'new webhook logs', afterJobs - beforeJobs);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('[verify] FAIL', e.message || e);
  process.exit(1);
});
