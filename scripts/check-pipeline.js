const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const logs = await p.webhookLog.findMany({ orderBy: { createdAt: 'desc' }, take: 3 });
  const scores = await p.scoreHistory.findMany({ orderBy: { createdAt: 'desc' }, take: 3 });
  const audits = await p.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 3 });
  console.log(JSON.stringify({ logs, scores, audits }, null, 2));
}

main()
  .catch(console.error)
  .finally(() => p.$disconnect());
