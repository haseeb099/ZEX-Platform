import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminApiKeyGuard } from '@src/common/guards/admin-api-key.guard';
import { StartResearchDto } from './dto/research-agent.dto';
import { ResearchAgentService } from './research-agent.service';

@ApiTags('admin/research-agent')
@ApiBearerAuth()
@UseGuards(AdminApiKeyGuard)
@Controller('api/v1/admin/tenants/:tenantId')
export class ResearchAgentController {
  constructor(private readonly research: ResearchAgentService) {}

  @Post('prospects/:candidateId/research')
  start(
    @Param('tenantId') tenantId: string,
    @Param('candidateId') candidateId: string,
    @Body() dto: StartResearchDto,
  ) {
    return this.research.startResearch(tenantId, candidateId, dto);
  }

  @Get('prospects/:candidateId/research/latest')
  latest(@Param('tenantId') tenantId: string, @Param('candidateId') candidateId: string) {
    return this.research.getLatest(tenantId, candidateId);
  }

  @Get('prospects/:candidateId/research/history')
  history(@Param('tenantId') tenantId: string, @Param('candidateId') candidateId: string) {
    return this.research.getHistory(tenantId, candidateId);
  }

  @Get('prospects/:candidateId/research/:runId')
  getRun(
    @Param('tenantId') tenantId: string,
    @Param('candidateId') candidateId: string,
    @Param('runId') runId: string,
  ) {
    return this.research.getRun(tenantId, candidateId, runId);
  }
}
