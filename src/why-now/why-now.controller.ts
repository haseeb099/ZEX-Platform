import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminApiKeyGuard } from '@src/common/guards/admin-api-key.guard';
import { IngestSignalsDto, ScoreWhyNowDto } from './dto/why-now.dto';
import { WhyNowService } from './why-now.service';

@ApiTags('admin/why-now')
@ApiBearerAuth()
@UseGuards(AdminApiKeyGuard)
@Controller('api/v1/admin/tenants/:tenantId')
export class WhyNowController {
  constructor(private readonly whyNow: WhyNowService) {}

  @Post('prospects/:candidateId/signals')
  ingestSignals(
    @Param('tenantId') tenantId: string,
    @Param('candidateId') candidateId: string,
    @Body() body: IngestSignalsDto,
  ) {
    return this.whyNow.ingestSignals(tenantId, candidateId, body.signals ?? []);
  }

  @Post('prospects/:candidateId/why-now')
  score(
    @Param('tenantId') tenantId: string,
    @Param('candidateId') candidateId: string,
    @Body() dto: ScoreWhyNowDto,
  ) {
    return this.whyNow.scoreCandidate(tenantId, candidateId, dto);
  }

  @Get('prospects/:candidateId/why-now')
  latest(@Param('tenantId') tenantId: string, @Param('candidateId') candidateId: string) {
    return this.whyNow.getLatest(tenantId, candidateId);
  }

  @Get('prospects/:candidateId/why-now/history')
  history(@Param('tenantId') tenantId: string, @Param('candidateId') candidateId: string) {
    return this.whyNow.getHistory(tenantId, candidateId);
  }

  @Post('prospect-discovery/:runId/why-now')
  scoreRun(
    @Param('tenantId') tenantId: string,
    @Param('runId') runId: string,
    @Body() dto: ScoreWhyNowDto,
  ) {
    return this.whyNow.scoreDiscoveryRun(tenantId, runId, dto);
  }
}
