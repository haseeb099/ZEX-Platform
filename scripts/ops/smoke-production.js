#!/usr/bin/env node
'use strict';

/**
 * Production / pre-prod smoke (read-only by default).
 *
 * Required:
 *   SMOKE_BASE_URL (e.g. http://127.0.0.1:3000)
 *
 * Optional read-only checks:
 *   SMOKE_ADMIN_API_KEY + SMOKE_WORKSPACE_ID and/or SMOKE_TENANT_ID
 *   DATABASE_URL — migration table presence check via `prisma migrate status` when RUN_MIGRATE_STATUS=1
 *
 * Mutation smokes are NOT included. Exit non-zero on any failure. Secrets never printed.
 */

const { spawnSync } = require('child_process');
const { redactSecrets } = require('./lib/production-guards');

const failures = [];

function fail(msg) {
  failures.push(msg);
  console.error(`FAIL ${redactSecrets(msg)}`);
}

function ok(msg) {
  console.log(`OK   ${msg}`);
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body };
}

async function main() {
  const base = (process.env.SMOKE_BASE_URL || '').replace(/\/$/, '');
  if (!base) {
    fail('SMOKE_BASE_URL is required');
    process.exit(1);
  }

  // Health
  const health = await getJson(`${base}/health`);
  if (health.status === 200 && health.body?.status === 'ok') {
    if (health.body.checks?.database === 'ok' && health.body.checks?.redis === 'ok') {
      ok(`health (${health.body.release ? `release=${health.body.release}` : 'no release field'})`);
    } else {
      fail(`health degraded: ${JSON.stringify(health.body.checks)}`);
    }
  } else {
    fail(`health HTTP ${health.status}`);
  }

  // Ensure health payload does not leak secrets
  const healthDump = JSON.stringify(health.body || {}).toLowerCase();
  if (/password|master_key|admin_api_key|webhooksecret|bearer [a-z0-9]/.test(healthDump)) {
    fail('health payload appears to contain secrets');
  } else {
    ok('health payload has no obvious secrets');
  }

  // Optional migrate status (connectivity / migrations applied)
  if (process.env.RUN_MIGRATE_STATUS === '1') {
    if (!process.env.DATABASE_URL) {
      fail('RUN_MIGRATE_STATUS=1 requires DATABASE_URL');
    } else {
      const prismaCli = require.resolve('prisma/build/index.js');
      const r = spawnSync(process.execPath, [prismaCli, 'migrate', 'status'], {
        encoding: 'utf8',
        env: process.env,
      });
      const out = `${r.stdout || ''}\n${r.stderr || ''}`;
      if (r.status === 0 && /Database schema is up to date|No pending migrations/i.test(out)) {
        ok('prisma migrate status: up to date');
      } else if (r.status === 0) {
        ok('prisma migrate status: exited 0');
      } else {
        fail(`prisma migrate status failed: ${redactSecrets(out).slice(0, 400)}`);
      }
    }
  }

  const adminKey = process.env.SMOKE_ADMIN_API_KEY || '';
  const workspaceId = process.env.SMOKE_WORKSPACE_ID || '';
  const tenantId = process.env.SMOKE_TENANT_ID || '';

  let resolvedTenantId = tenantId || null;

  if (adminKey && workspaceId) {
    const ws = await getJson(`${base}/api/v1/admin/tenants/by-workspace/${workspaceId}`, {
      authorization: `Bearer ${adminKey}`,
    });
    if (ws.status === 200 && ws.body?.tenantId) {
      ok(`workspace→tenant resolution (${ws.body.tenantId})`);
      resolvedTenantId = resolvedTenantId || ws.body.tenantId;
      if (tenantId && ws.body.tenantId !== tenantId) {
        fail(`workspace resolved to ${ws.body.tenantId}, expected ${tenantId}`);
      }
    } else if (ws.status === 409) {
      fail(
        `by-workspace HTTP 409 (workspace must map to exactly one tenant for smoke; pick a unique SMOKE_WORKSPACE_ID)`,
      );
    } else {
      fail(`by-workspace HTTP ${ws.status}`);
    }
  } else {
    console.log('SKIP workspace resolution (set SMOKE_ADMIN_API_KEY + SMOKE_WORKSPACE_ID)');
  }

  const effectiveTenant = resolvedTenantId;
  if (adminKey && effectiveTenant) {
    const agents = await getJson(`${base}/api/v1/admin/tenants/${effectiveTenant}/agents`, {
      authorization: `Bearer ${adminKey}`,
    });
    if (agents.status === 200 && agents.body?.version === 'agent-control-v1') {
      ok(`agents overview version=${agents.body.version}`);
    } else {
      fail(`agents overview HTTP ${agents.status}`);
    }

    const feed = await getJson(`${base}/api/v1/admin/tenants/${effectiveTenant}/action-feed?limit=5`, {
      authorization: `Bearer ${adminKey}`,
    });
    if (feed.status === 200 && feed.body?.version) {
      ok(`action-feed version=${feed.body.version}`);
    } else {
      fail(`action-feed HTTP ${feed.status}`);
    }

    const dump = JSON.stringify({ agents: agents.body, feed: feed.body }).toLowerCase();
    if (/master_key|admin_api_key|webhooksecret|password":\s*"[^"]+"/.test(dump)) {
      fail('admin smoke payloads appear to contain secrets');
    } else {
      ok('admin smoke payloads have no obvious secrets');
    }
  } else {
    console.log('SKIP agents/action-feed (set SMOKE_ADMIN_API_KEY + SMOKE_TENANT_ID)');
  }

  if (failures.length) {
    console.error(`Smoke failed with ${failures.length} error(s)`);
    process.exit(1);
  }
  console.log('Smoke PASS');
  process.exit(0);
}

main().catch(err => {
  fail(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
