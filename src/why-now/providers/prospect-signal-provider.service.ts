import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PROSPECT_SIGNAL_PROVIDER,
  ProspectSignalProvider,
  ProspectSignalProviderContext,
  ProspectSignalProviderResult,
  providerSignalResultSchema,
} from '../why-now.types';
import { DeterministicProspectSignalProvider } from './deterministic.provider';

@Injectable()
export class ProspectSignalProviderService implements ProspectSignalProvider {
  readonly name: string;
  private readonly provider: ProspectSignalProvider;

  constructor(
    private readonly config: ConfigService,
    private readonly deterministic: DeterministicProspectSignalProvider,
    @Optional()
    @Inject(PROSPECT_SIGNAL_PROVIDER)
    injected?: ProspectSignalProvider,
  ) {
    const preferDeterministic =
      this.config.get<boolean>('WHY_NOW_DETERMINISTIC') === true ||
      this.config.get<string>('NODE_ENV') === 'test';
    this.provider = preferDeterministic || !injected ? this.deterministic : injected;
    this.name = this.provider.name;
  }

  async collect(context: ProspectSignalProviderContext): Promise<ProspectSignalProviderResult> {
    return providerSignalResultSchema.parse(await this.provider.collect(context));
  }
}
