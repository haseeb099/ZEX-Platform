import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { ResearchFixture } from '../research-agent.types';

export class StartResearchDto {
  @IsOptional()
  @IsBoolean()
  sync?: boolean;

  @IsOptional()
  @IsIn([
    'strong_research',
    'sparse_research',
    'conflicting_research',
    'stale_research',
    'no_research',
    'provider_failure',
  ])
  fixture?: ResearchFixture;
}
