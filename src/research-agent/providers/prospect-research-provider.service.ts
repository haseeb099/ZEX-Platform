import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PROSPECT_RESEARCH_PROVIDER,
  ProspectResearchProvider,
  ProspectResearchProviderContext,
  ProviderResearchResult,
} from '../research-agent.types';
import { DeterministicProspectResearchProvider } from './deterministic.provider';

@Injectable()
export class ProspectResearchProviderService {
  constructor(
    private readonly config: ConfigService,
    private readonly deterministic: DeterministicProspectResearchProvider,
    @Optional()
    @Inject(PROSPECT_RESEARCH_PROVIDER)
    private readonly productionProvider?: ProspectResearchProvider,
  ) {}

  async research(context: ProspectResearchProviderContext): Promise<ProviderResearchResult> {
    const useDeterministic =
      this.config.get<boolean>('RESEARCH_AGENT_DETERMINISTIC') === true ||
      this.config.get<string>('NODE_ENV') === 'test' ||
      !this.productionProvider;

    const provider = useDeterministic ? this.deterministic : this.productionProvider!;
    return provider.research(context);
  }
}
