import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AdminApiKeyGuard } from '@src/common/guards/admin-api-key.guard';
import { ENRICH_AND_SCORE_QUEUE } from '@src/jobs/jobs.constants';

@ApiTags('admin/jobs')
@ApiBearerAuth()
@UseGuards(AdminApiKeyGuard)
@Controller('api/v1/admin/jobs')
export class JobsAdminController {
  constructor(@InjectQueue(ENRICH_AND_SCORE_QUEUE) private readonly queue: Queue) {}

  @Get('dlq')
  async listDlq() {
    const failed = await this.queue.getFailed(0, 100);
    return {
      count: failed.length,
      jobs: failed.map(j => ({
        id: j.id,
        name: j.name,
        failedReason: j.failedReason,
        attemptsMade: j.attemptsMade,
        data: j.data,
        finishedOn: j.finishedOn,
      })),
    };
  }
}
