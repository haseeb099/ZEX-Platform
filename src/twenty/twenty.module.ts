import { Module } from '@nestjs/common';
import { TwentyClient } from './twenty.client';
import { TwentyConnectionService } from './twenty-connection.service';

@Module({
  providers: [TwentyConnectionService, TwentyClient],
  exports: [TwentyConnectionService, TwentyClient],
})
export class TwentyModule {}
