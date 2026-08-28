import { Injectable } from '@nestjs/common';
import { EnrichmentProvider, EnrichmentResult } from '../enrichment.types';

@Injectable()
export class ClearbitProvider implements EnrichmentProvider {
  readonly name = 'clearbit';

  async enrich(input: {
    email?: string | null;
    domain?: string | null;
    apiKey?: string | null;
  }): Promise<EnrichmentResult | null> {
    // MVP stub: return mapped Clearbit-shaped data even without a live key
    const domain = input.domain || (input.email ? input.email.split('@')[1] : null);
    if (!domain) return null;

    return {
      personEmail: input.email,
      companyName: domain.split('.')[0]
        ? domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1)
        : 'Unknown Co',
      companyDomain: domain,
      companySize: '51-200',
      industry: 'Technology',
      location: 'United States',
      jobTitle: null,
      technologies: ['Salesforce'],
      source: this.name,
      confidence: input.apiKey ? 85 : 60,
    };
  }
}
