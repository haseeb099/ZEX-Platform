import { IsArray, IsBoolean, IsIn, IsOptional } from 'class-validator';
import { WhyNowFixture } from '../why-now.types';

export class ScoreWhyNowDto {
  @IsOptional()
  @IsBoolean()
  sync?: boolean;

  /** Collect signals via provider before scoring. */
  @IsOptional()
  @IsBoolean()
  collectSignals?: boolean;

  @IsOptional()
  @IsIn(['strong_why_now', 'no_signal', 'stale_signal', 'bad_fit_recent', 'conflicting'])
  fixture?: WhyNowFixture;
}

export class IngestSignalsDto {
  @IsArray()
  signals!: unknown[];
}
