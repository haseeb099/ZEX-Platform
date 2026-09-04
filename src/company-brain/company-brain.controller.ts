import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminApiKeyGuard } from '@src/common/guards/admin-api-key.guard';
import { CompanyBrainService } from './company-brain.service';
import {
  AddCompanyBrainSourceDto,
  AnalyzeCompanyBrainDto,
  CreateCompanyBrainDto,
  PatchCompanyBrainDto,
  PatchMessagingSummaryDto,
  UpsertPersonaDto,
  UpsertQualificationRuleDto,
} from './dto/company-brain.dto';

@ApiTags('admin/company-brain')
@ApiBearerAuth()
@UseGuards(AdminApiKeyGuard)
@Controller('api/v1/admin/tenants/:tenantId/company-brain')
export class CompanyBrainController {
  constructor(private readonly companyBrain: CompanyBrainService) {}

  @Get()
  list(@Param('tenantId') tenantId: string) {
    return this.companyBrain.listBrains(tenantId);
  }

  @Post()
  create(@Param('tenantId') tenantId: string, @Body() dto: CreateCompanyBrainDto) {
    return this.companyBrain.create(tenantId, dto);
  }

  @Get(':brainId')
  get(@Param('tenantId') tenantId: string, @Param('brainId') brainId: string) {
    return this.companyBrain.getBrain(tenantId, brainId);
  }

  @Post(':brainId/sources')
  addSource(
    @Param('tenantId') tenantId: string,
    @Param('brainId') brainId: string,
    @Body() dto: AddCompanyBrainSourceDto,
  ) {
    return this.companyBrain.addSource(tenantId, brainId, dto);
  }

  @Post(':brainId/analyze')
  analyze(
    @Param('tenantId') tenantId: string,
    @Param('brainId') brainId: string,
    @Body() dto: AnalyzeCompanyBrainDto,
  ) {
    return this.companyBrain.enqueueOrRunAnalysis(tenantId, brainId, {
      sync: dto.sync === true,
      triggeredBy: 'admin-api',
    });
  }

  @Get(':brainId/analysis-jobs/:jobId')
  getJob(
    @Param('tenantId') tenantId: string,
    @Param('brainId') brainId: string,
    @Param('jobId') jobId: string,
  ) {
    return this.companyBrain.getAnalysisJob(tenantId, brainId, jobId);
  }

  @Patch(':brainId')
  patch(
    @Param('tenantId') tenantId: string,
    @Param('brainId') brainId: string,
    @Body() dto: PatchCompanyBrainDto,
  ) {
    return this.companyBrain.patchBrain(tenantId, brainId, dto);
  }

  @Put(':brainId/personas')
  upsertPersona(
    @Param('tenantId') tenantId: string,
    @Param('brainId') brainId: string,
    @Body() dto: UpsertPersonaDto,
  ) {
    return this.companyBrain.upsertPersona(tenantId, brainId, dto);
  }

  @Delete(':brainId/personas/:personaId')
  removePersona(
    @Param('tenantId') tenantId: string,
    @Param('brainId') brainId: string,
    @Param('personaId') personaId: string,
  ) {
    return this.companyBrain.removePersona(tenantId, brainId, personaId);
  }

  @Put(':brainId/qualification-rules')
  upsertRule(
    @Param('tenantId') tenantId: string,
    @Param('brainId') brainId: string,
    @Body() dto: UpsertQualificationRuleDto,
  ) {
    return this.companyBrain.upsertQualificationRule(tenantId, brainId, dto);
  }

  @Patch(':brainId/messaging')
  patchMessaging(
    @Param('tenantId') tenantId: string,
    @Param('brainId') brainId: string,
    @Body() dto: PatchMessagingSummaryDto,
  ) {
    return this.companyBrain.patchMessaging(tenantId, brainId, dto);
  }

  @Post(':brainId/regenerate')
  regenerate(
    @Param('tenantId') tenantId: string,
    @Param('brainId') brainId: string,
    @Body() dto: AnalyzeCompanyBrainDto,
  ) {
    return this.companyBrain.enqueueOrRunAnalysis(tenantId, brainId, {
      sync: dto.sync === true,
      triggeredBy: 'admin-api:regenerate',
    });
  }
}
