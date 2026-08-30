import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EnrichmentService } from './enrichment.service';
import { ApolloProvider } from './providers/apollo.provider';
import { ClearbitProvider } from './providers/clearbit.provider';
import { FallbackProvider } from './providers/fallback.provider';
import { HunterProvider } from './providers/hunter.provider';

@Module({
  imports: [ConfigModule],
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
