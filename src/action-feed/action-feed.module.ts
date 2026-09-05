import { Module } from '@nestjs/common';
import { ActionFeedController } from './action-feed.controller';
import { ActionFeedService } from './action-feed.service';

@Module({
  controllers: [ActionFeedController],
  providers: [ActionFeedService],
  exports: [ActionFeedService],
})
export class ActionFeedModule {}
