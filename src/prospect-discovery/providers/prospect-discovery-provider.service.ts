import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PROSPECT_DISCOVERY_PROVIDER,
  ProspectDiscoveryIcpInput,
  ProspectDiscoveryProvider,
  ProspectDiscoveryProviderResult,
  providerResultSchema,
} from '../prospect-discovery.types';
import { DeterministicProspectDiscoveryProvider } from './deterministic.provider';

@Injectable()
export class ProspectDiscoveryProviderService implements ProspectDiscoveryProvider {
  readonly name: string;
  private readonly provider: ProspectDiscoveryProvider;

  constructor(
    private readonly config: ConfigService,
    private readonly deterministic: DeterministicProspectDiscoveryProvider,
    @Optional()
    @Inject(PROSPECT_DISCOVERY_PROVIDER)
    injected?: ProspectDiscoveryProvider,
  ) {
    const preferDeterministic =
      this.config.get<boolean>('PROSPECT_DISCOVERY_DETERMINISTIC') === true ||
      this.config.get<string>('NODE_ENV') === 'test';
    this.provider = preferDeterministic || !injected ? this.deterministic : injected;
    this.name = this.provider.name;
  }

  async discover(input: ProspectDiscoveryIcpInput): Promise<ProspectDiscoveryProviderResult> {
    return providerResultSchema.parse(await this.provider.discover(input));
  }
}
