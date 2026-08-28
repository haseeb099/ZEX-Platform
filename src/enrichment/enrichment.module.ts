import { Module } from '@nestjs/common';
import { EnrichmentService } from './enrichment.service';
import { ApolloProvider } from './providers/apollo.provider';
import { ClearbitProvider } from './providers/clearbit.provider';
import { FallbackProvider } from './providers/fallback.provider';
import { HunterProvider } from './providers/hunter.provider';

@Module({
  providers: [
    EnrichmentService,
    ClearbitProvider,
    ApolloProvider,
    HunterProvider,
    FallbackProvider,
  ],
  exports: [EnrichmentService],
})
export class EnrichmentModule {}
