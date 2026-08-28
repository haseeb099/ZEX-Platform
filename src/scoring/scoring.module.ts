import { Module } from '@nestjs/common';
import { ScoringEngine } from './scoring.engine';
import { ScoringService } from './scoring.service';

@Module({
  providers: [ScoringEngine, ScoringService],
  exports: [ScoringService, ScoringEngine],
})
export class ScoringModule {}
