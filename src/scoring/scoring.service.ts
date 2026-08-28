import { Injectable } from '@nestjs/common';
import { EnrichmentResult } from '@src/enrichment/enrichment.types';
import { TwentyPerson } from '@src/twenty/twenty.types';
import { ScoringEngine } from './scoring.engine';

@Injectable()
export class ScoringService {
  constructor(private readonly engine: ScoringEngine) {}

  score(tenantId: string, person: TwentyPerson, enrichment: EnrichmentResult) {
    return this.engine.score(tenantId, person, enrichment);
  }
}
