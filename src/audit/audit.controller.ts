import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminApiKeyGuard } from '@src/common/guards/admin-api-key.guard';
import { PrismaService } from '@src/common/prisma/prisma.service';

@ApiTags('admin/audit')
@ApiBearerAuth()
@UseGuards(AdminApiKeyGuard)
@Controller('api/v1/admin/tenants/:tenantId/audit')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Param('tenantId') tenantId: string,
    @Query('action') action?: string,
    @Query('limit') limit = '50',
    @Query('offset') offset = '0',
  ) {
    const take = Math.min(Number(limit) || 50, 200);
    const skip = Number(offset) || 0;
    const where = {
      tenantId,
      ...(action ? { action } : {}),
    };
    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { logs, total };
  }
}
