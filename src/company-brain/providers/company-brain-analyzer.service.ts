import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  COMPANY_BRAIN_ANALYZER,
  CompanyBrainAnalyzer,
  CompanyBrainPayload,
  NormalizedSourceDocument,
  companyBrainPayloadSchema,
} from '../company-brain.types';
import { DeterministicCompanyBrainAnalyzer } from './deterministic.analyzer';

/**
 * Facade selecting the active Company Brain analyzer.
 * Production may inject an LLM-backed analyzer; without credentials we keep the deterministic provider.
 */
@Injectable()
export class CompanyBrainAnalyzerService implements CompanyBrainAnalyzer {
  readonly name: string;
  private readonly analyzer: CompanyBrainAnalyzer;

  constructor(
    private readonly config: ConfigService,
    private readonly deterministic: DeterministicCompanyBrainAnalyzer,
    @Optional()
    @Inject(COMPANY_BRAIN_ANALYZER)
    injected?: CompanyBrainAnalyzer,
  ) {
    const preferDeterministic =
      this.config.get<boolean>('COMPANY_BRAIN_DETERMINISTIC') === true ||
      this.config.get<string>('NODE_ENV') === 'test';

    if (preferDeterministic || !injected) {
      this.analyzer = this.deterministic;
    } else {
      this.analyzer = injected;
    }
    this.name = this.analyzer.name;
  }

  async analyze(input: {
    companyName: string;
    websiteUrl?: string | null;
    sources: NormalizedSourceDocument[];
  }): Promise<CompanyBrainPayload> {
    const raw = await this.analyzer.analyze(input);
    return companyBrainPayloadSchema.parse(raw);
  }
}
