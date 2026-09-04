import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { mapBuyerRolesFromPersonas } from '../buyer-role-mapper';
import {
  ProspectDiscoveryIcpInput,
  ProspectDiscoveryProvider,
  ProspectDiscoveryProviderResult,
  providerResultSchema,
} from '../prospect-discovery.types';

/**
 * Deterministic discovery provider for CI/tests.
 * Returns a fixed mix: strong match, disqualified, CRM-duplicate domain, and a second new valid candidate.
 */
@Injectable()
export class DeterministicProspectDiscoveryProvider implements ProspectDiscoveryProvider {
  readonly name = 'deterministic';

  async discover(input: ProspectDiscoveryIcpInput): Promise<ProspectDiscoveryProviderResult> {
    const limit = input.limit ?? 10;
    const industries = input.icp.industries.length ? input.icp.industries : ['SaaS'];
    const geography = input.icp.geography[0] ?? 'US';
    const size = input.icp.companySize[0] ?? '11-50';
    const disqualifier = input.icp.disqualifiers[0] ?? 'consumer marketplaces';

    const strongKey = 'det_strong_fit';
    const weakKey = 'det_disqualified';
    const dupKey = 'det_crm_duplicate';
    const newKey = 'det_new_valid';

    const strongRoles = mapBuyerRolesFromPersonas(input, {
      companyName: 'Northwind Analytics',
      providerKey: strongKey,
    });

    const candidates = [
      {
        providerKey: strongKey,
        companyName: 'Northwind Analytics',
        domain: 'northwind-analytics.example',
        websiteUrl: 'https://northwind-analytics.example',
        industry: industries[0],
        companySize: size,
        geography,
        description: `B2B ${industries[0]} platform aligned to ICP use cases`,
        buyerRoles: strongRoles,
        evidence: [
          {
            source: 'deterministic-provider',
            sourceUrl: 'https://northwind-analytics.example',
            excerpt: `${industries[0]} company in ${geography}`,
            confidence: 0.9,
          },
        ],
      },
      {
        providerKey: weakKey,
        companyName: 'Consumer Bazaar',
        domain: 'consumer-bazaar.example',
        websiteUrl: 'https://consumer-bazaar.example',
        industry: disqualifier,
        companySize: '1-10',
        geography: 'Global',
        description: `Focused on ${disqualifier}`,
        buyerRoles: mapBuyerRolesFromPersonas(input, {
          companyName: 'Consumer Bazaar',
          providerKey: weakKey,
        }),
        evidence: [
          {
            source: 'deterministic-provider',
            excerpt: disqualifier,
            field: 'industry',
            confidence: 0.85,
          },
        ],
      },
      {
        providerKey: dupKey,
        companyName: 'Acme Duplicate Co',
        domain: 'acme-duplicate.example',
        websiteUrl: 'https://acme-duplicate.example',
        industry: industries[0],
        companySize: size,
        geography,
        description: 'Known CRM duplicate fixture',
        buyerRoles: mapBuyerRolesFromPersonas(input, {
          companyName: 'Acme Duplicate Co',
          providerKey: dupKey,
        }),
        evidence: [
          {
            source: 'deterministic-provider',
            sourceUrl: 'https://acme-duplicate.example',
            excerpt: 'acme-duplicate.example',
            confidence: 0.95,
          },
        ],
      },
      {
        providerKey: newKey,
        companyName: 'Brightline Ops',
        domain: `brightline-${stableSuffix(input.companyName)}.example`,
        websiteUrl: `https://brightline-${stableSuffix(input.companyName)}.example`,
        industry: industries[0],
        companySize: size,
        geography,
        description: 'New valid ICP-aligned prospect',
        buyerRoles: mapBuyerRolesFromPersonas(input, {
          companyName: 'Brightline Ops',
          providerKey: newKey,
        }),
        evidence: [
          {
            source: 'deterministic-provider',
            excerpt: industries[0],
            confidence: 0.8,
          },
        ],
      },
    ];

    return providerResultSchema.parse({
      provider: this.name,
      candidates: candidates.slice(0, limit),
    });
  }
}

function stableSuffix(value: string): string {
  return createHash('sha1').update(value.toLowerCase()).digest('hex').slice(0, 6);
}
