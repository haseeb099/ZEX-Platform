import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminApiKeyGuard } from '@src/common/guards/admin-api-key.guard';
import { AgentControlService } from './agent-control.service';
import { agentActionsQuerySchema, agentsQuerySchema, undoBodySchema } from './agent-control.types';

@ApiTags('admin/agent-control')
@ApiBearerAuth()
@UseGuards(AdminApiKeyGuard)
@Controller('api/v1/admin/tenants/:tenantId')
export class AgentControlController {
  constructor(private readonly agents: AgentControlService) {}

  @Get('agents')
  getOverview(@Param('tenantId') tenantId: string, @Query() query: Record<string, unknown>) {
    const parsed = agentsQuerySchema.parse(query);
    return this.agents.getOverview(tenantId, parsed.recentLimit);
  }

  @Get('agent-actions')
  listActions(@Param('tenantId') tenantId: string, @Query() query: Record<string, unknown>) {
    const parsed = agentActionsQuerySchema.parse(query);
    return this.agents.listActions(tenantId, {
      agentId: parsed.agentId,
      limit: parsed.limit,
      offset: parsed.offset,
    });
  }

  @Post('agents/:agentId/pause')
  @HttpCode(HttpStatus.OK)
  pause(
    @Param('tenantId') tenantId: string,
    @Param('agentId') agentId: string,
    @Body() body: { triggeredBy?: string } = {},
  ) {
    return this.agents.pauseAgent(tenantId, agentId, body?.triggeredBy || 'admin-api');
  }

  @Post('agents/:agentId/resume')
  @HttpCode(HttpStatus.OK)
  resume(
    @Param('tenantId') tenantId: string,
    @Param('agentId') agentId: string,
    @Body() body: { triggeredBy?: string } = {},
  ) {
    return this.agents.resumeAgent(tenantId, agentId, body?.triggeredBy || 'admin-api');
  }

  @Post('agent-actions/:actionId/undo')
  @HttpCode(HttpStatus.OK)
  undo(
    @Param('tenantId') tenantId: string,
    @Param('actionId') actionId: string,
    @Body() body: unknown,
  ) {
    const parsed = undoBodySchema.parse(body ?? {});
    return this.agents.undoAction(tenantId, actionId, parsed.triggeredBy || 'admin-api');
  }
}
