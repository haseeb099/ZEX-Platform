import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsObject, IsOptional, IsString, Min, Max } from 'class-validator';
import { Prisma } from '@prisma/client';
import { AdminApiKeyGuard } from '@src/common/guards/admin-api-key.guard';
import { PrismaService } from '@src/common/prisma/prisma.service';

class CreateScoringRuleDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsObject()
  rules!: Record<string, unknown>;
}

class PatchTenantConfigDto {
  @IsOptional()
  @IsBoolean()
  enableAutoOpportunity?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  opportunityThreshold?: number;

  @IsOptional()
  @IsBoolean()
  enableEnrichment?: boolean;
}

@ApiTags('admin/config')
@ApiBearerAuth()
@UseGuards(AdminApiKeyGuard)
@Controller('api/v1/admin/tenants/:tenantId')
export class TenantConfigController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('scoring-rules')
  async listRules(@Param('tenantId') tenantId: string) {
    const rules = await this.prisma.scoringRule.findMany({
      where: { tenantId },
      orderBy: { priority: 'desc' },
    });
    return { rules };
  }

  @Post('scoring-rules')
  async createRule(@Param('tenantId') tenantId: string, @Body() dto: CreateScoringRuleDto) {
    const tenant = await this.prisma.tenant.findFirst({ where: { id: tenantId, deletedAt: null } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const rule = await this.prisma.scoringRule.create({
      data: {
        tenantId,
        name: dto.name,
        enabled: dto.enabled ?? true,
        priority: dto.priority ?? 0,
        rules: dto.rules as Prisma.InputJsonValue,
      },
    });
    return rule;
  }

  @Get('config')
  async getConfig(@Param('tenantId') tenantId: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      include: { scoringRules: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return {
      tenantId: tenant.id,
      name: tenant.name,
      plan: tenant.plan,
      settings: {
        autoOpportunity: {
          enabled: tenant.enableAutoOpportunity,
          threshold: tenant.opportunityThreshold,
        },
        enrichment: {
          enabled: tenant.enableEnrichment,
          providers: tenant.enrichmentProviders,
          monthlyBudget: tenant.enrichmentRequestsPerMonth,
        },
        scoring: { rules: tenant.scoringRules },
      },
    };
  }

  @Patch('config')
  async patchConfig(@Param('tenantId') tenantId: string, @Body() dto: PatchTenantConfigDto) {
    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(dto.enableAutoOpportunity !== undefined
          ? { enableAutoOpportunity: dto.enableAutoOpportunity }
          : {}),
        ...(dto.opportunityThreshold !== undefined
          ? { opportunityThreshold: dto.opportunityThreshold }
          : {}),
        ...(dto.enableEnrichment !== undefined ? { enableEnrichment: dto.enableEnrichment } : {}),
      },
    });
    return {
      tenantId: tenant.id,
      settings: {
        autoOpportunity: {
          enabled: tenant.enableAutoOpportunity,
          threshold: tenant.opportunityThreshold,
        },
        enrichment: { enabled: tenant.enableEnrichment },
      },
    };
  }
}
