import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminApiKeyGuard } from '@src/common/guards/admin-api-key.guard';
import { ActionFeedService } from './action-feed.service';
import { actionFeedQuerySchema } from './action-feed.types';

@ApiTags('admin/action-feed')
@ApiBearerAuth()
@UseGuards(AdminApiKeyGuard)
@Controller('api/v1/admin/tenants/:tenantId')
export class ActionFeedController {
  constructor(private readonly feed: ActionFeedService) {}

  @Get('action-feed')
  getFeed(@Param('tenantId') tenantId: string, @Query() query: Record<string, unknown>) {
    const parsed = actionFeedQuerySchema.parse(query);
    return this.feed.getFeed(tenantId, parsed.limit);
  }
}
