const { PrismaClient } = require('@prisma/client');

const tenantId = process.argv[2] || 'cmt4tqu4x0000196hl8gwqizv';
const prisma = new PrismaClient();

async function main() {
  const logs = await prisma.webhookLog.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  const scores = await prisma.scoreHistory.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  const audits = await prisma.auditLog.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  console.log(JSON.stringify({ tenantId, logs, scores, audits }, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
