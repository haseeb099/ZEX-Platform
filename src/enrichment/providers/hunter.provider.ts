import { Injectable } from '@nestjs/common';
import { EnrichmentProvider, EnrichmentResult } from '../enrichment.types';

@Injectable()
export class HunterProvider implements EnrichmentProvider {
  readonly name = 'hunter';

  async enrich(input: {
    email?: string | null;
    domain?: string | null;
    apiKey?: string | null;
  }): Promise<EnrichmentResult | null> {
    if (!input.email && !input.domain) return null;
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
      confidence: 50,
    };
  }
}
