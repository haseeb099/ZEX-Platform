import { Injectable } from '@nestjs/common';
import { CryptoService } from '@src/common/crypto.service';
import { PrismaService } from '@src/common/prisma/prisma.service';
import { TwentyPerson } from '@src/twenty/twenty.types';
import { EnrichmentResult } from './enrichment.types';
import { ApolloProvider } from './providers/apollo.provider';
import { ClearbitProvider } from './providers/clearbit.provider';
import { FallbackProvider } from './providers/fallback.provider';
import { HunterProvider } from './providers/hunter.provider';

const CACHE_DAYS = 7;

@Injectable()
export class EnrichmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly clearbit: ClearbitProvider,
    private readonly apollo: ApolloProvider,
    private readonly hunter: HunterProvider,
    private readonly fallback: FallbackProvider,
  ) {}

  async enrichPerson(tenantId: string, person: TwentyPerson): Promise<EnrichmentResult> {
    const cached = await this.prisma.enrichedPerson.findUnique({
      where: {
        tenantId_personTwentyId: { tenantId, personTwentyId: person.id },
      },
    });

    if (cached && this.isRecent(cached.enrichedAt, CACHE_DAYS)) {
      return {
        personEmail: cached.personEmail,
        companyName: cached.companyName,
        companyDomain: cached.companyDomain,
        companySize: cached.companySize,
        industry: cached.industry,
        location: cached.location,
        jobTitle: cached.jobTitle,
        jobFunction: cached.jobFunction,
        technologies: cached.technologies,
        source: cached.source || 'cache',
        confidence: cached.confidence,
      };
    }

    const providerCfg = await this.prisma.enrichmentProvider.findUnique({
      where: { tenantId },
    });

    const domain = person.company?.website || person.email?.split('@')[1] || null;
    const chain = [
      () =>
        this.clearbit.enrich({
          email: person.email,
          domain,
          apiKey: providerCfg?.clearbitApiKey
            ? this.crypto.decrypt(providerCfg.clearbitApiKey)
            : process.env.CLEARBIT_API_KEY || null,
        }),
      () =>
        this.apollo.enrich({
          email: person.email,
          domain,
          apiKey: providerCfg?.apolloApiKey
            ? this.crypto.decrypt(providerCfg.apolloApiKey)
            : process.env.APOLLO_API_KEY || null,
        }),
      () =>
        this.hunter.enrich({
          email: person.email,
          domain,
          apiKey: providerCfg?.hunterApiKey
            ? this.crypto.decrypt(providerCfg.hunterApiKey)
            : process.env.HUNTER_API_KEY || null,
        }),
      () => this.fallback.enrich({ email: person.email, domain }),
    ];

    let result: EnrichmentResult | null = null;
    for (const step of chain) {
      try {
        result = await step();
        if (result) break;
      } catch {
        // continue fallback
      }
    }

    if (!result) {
      result = await this.fallback.enrich({ email: person.email, domain });
    }

    await this.prisma.enrichedPerson.upsert({
      where: {
        tenantId_personTwentyId: { tenantId, personTwentyId: person.id },
      },
      create: {
        tenantId,
        personTwentyId: person.id,
        personEmail: result.personEmail,
        companyName: result.companyName,
        companyDomain: result.companyDomain,
        companySize: result.companySize,
        industry: result.industry,
        location: result.location,
        jobTitle: result.jobTitle || person.jobTitle,
        jobFunction: result.jobFunction,
        technologies: result.technologies || [],
        source: result.source,
        confidence: result.confidence,
      },
      update: {
        personEmail: result.personEmail,
        companyName: result.companyName,
        companyDomain: result.companyDomain,
        companySize: result.companySize,
        industry: result.industry,
        location: result.location,
        jobTitle: result.jobTitle || person.jobTitle,
        jobFunction: result.jobFunction,
        technologies: result.technologies || [],
        source: result.source,
        confidence: result.confidence,
        enrichedAt: new Date(),
      },
    });

    return {
      ...result,
      jobTitle: result.jobTitle || person.jobTitle || null,
    };
  }

  private isRecent(date: Date, days: number): boolean {
    const ageMs = Date.now() - date.getTime();
    return ageMs <= days * 24 * 60 * 60 * 1000;
  }
}
