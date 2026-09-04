import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminApiKeyGuard } from '@src/common/guards/admin-api-key.guard';
import { StartProspectDiscoveryDto } from './dto/prospect-discovery.dto';
import { ProspectDiscoveryService } from './prospect-discovery.service';

@ApiTags('admin/prospect-discovery')
@ApiBearerAuth()
@UseGuards(AdminApiKeyGuard)
@Controller('api/v1/admin/tenants/:tenantId/prospect-discovery')
export class ProspectDiscoveryController {
  constructor(private readonly discovery: ProspectDiscoveryService) {}

  @Post()
  start(@Param('tenantId') tenantId: string, @Body() dto: StartProspectDiscoveryDto) {
    return this.discovery.startDiscovery(tenantId, dto);
  }

  @Get('candidates/:candidateId')
  getCandidate(@Param('tenantId') tenantId: string, @Param('candidateId') candidateId: string) {
    return this.discovery.getCandidate(tenantId, candidateId);
  }

  @Post('candidates/:candidateId/approve')
  approve(@Param('tenantId') tenantId: string, @Param('candidateId') candidateId: string) {
    return this.discovery.approveCandidate(tenantId, candidateId);
  }

  @Post('candidates/:candidateId/reject')
  reject(@Param('tenantId') tenantId: string, @Param('candidateId') candidateId: string) {
    return this.discovery.rejectCandidate(tenantId, candidateId);
  }

  @Post('candidates/:candidateId/create')
  create(@Param('tenantId') tenantId: string, @Param('candidateId') candidateId: string) {
    return this.discovery.createApprovedCandidate(tenantId, candidateId);
  }

  @Post('candidates/:candidateId/retry-create')
  retry(@Param('tenantId') tenantId: string, @Param('candidateId') candidateId: string) {
    return this.discovery.createApprovedCandidate(tenantId, candidateId, 'admin-api:retry');
  }

  @Get(':runId/candidates')
  listCandidates(@Param('tenantId') tenantId: string, @Param('runId') runId: string) {
    return this.discovery.listCandidates(tenantId, runId);
  }

  @Get(':runId')
  getRun(@Param('tenantId') tenantId: string, @Param('runId') runId: string) {
    return this.discovery.getRun(tenantId, runId);
  }
}
