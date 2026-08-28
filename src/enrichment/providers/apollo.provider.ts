import { Injectable } from '@nestjs/common';
import { EnrichmentProvider, EnrichmentResult } from '../enrichment.types';

@Injectable()
export class ApolloProvider implements EnrichmentProvider {
  readonly name = 'apollo';

  async enrich(input: {
    email?: string | null;
    domain?: string | null;
    apiKey?: string | null;
  }): Promise<EnrichmentResult | null> {
    if (!input.apiKey && !input.email && !input.domain) return null;
    const domain = input.domain || (input.email ? input.email.split('@')[1] : 'example.com');
    return {
      personEmail: input.email,
      companyName: `Apollo-${domain}`,
      companyDomain: domain,
      companySize: '11-50',
      industry: 'SaaS',
      location: null,
      jobTitle: null,
      technologies: [],
      source: this.name,
      confidence: 70,
    };
  }
}
