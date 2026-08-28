import { Injectable } from '@nestjs/common';
import { EnrichmentProvider, EnrichmentResult } from '../enrichment.types';

@Injectable()
export class FallbackProvider implements EnrichmentProvider {
  readonly name = 'manual';

  async enrich(input: {
    email?: string | null;
    domain?: string | null;
  }): Promise<EnrichmentResult> {
    return {
      personEmail: input.email,
      companyName: null,
      companyDomain: input.domain || input.email?.split('@')[1] || null,
      companySize: null,
      industry: null,
      location: null,
      jobTitle: null,
      technologies: [],
      source: this.name,
      confidence: 20,
    };
  }
}
