import {
  Allow,
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { COMPANY_BRAIN_SOURCE_TYPES } from '../company-brain.types';

export class CreateCompanyBrainDto {
  @IsString()
  @MaxLength(200)
  companyName!: string;

  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  websiteUrl?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] }, { each: true })
  extraUrls?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(100_000)
  pastedText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100_000)
  documentText?: string;

  @IsOptional()
  @IsBoolean()
  analyze?: boolean;

  /** Admin/debug: run analysis inline instead of enqueueing (default false). */
  @IsOptional()
  @IsBoolean()
  sync?: boolean;
}

export class AddCompanyBrainSourceDto {
  @IsIn(COMPANY_BRAIN_SOURCE_TYPES)
  sourceType!: (typeof COMPANY_BRAIN_SOURCE_TYPES)[number];

  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  sourceUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100_000)
  text?: string;
}

export class AnalyzeCompanyBrainDto {
  @IsOptional()
  @IsBoolean()
  sync?: boolean;
}

export class PatchCompanyBrainDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  companyName?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  websiteUrl?: string | null;

  @IsOptional()
  @IsObject()
  icp?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  personas?: Record<string, unknown>[];

  @IsOptional()
  @IsArray()
  painPoints?: Record<string, unknown>[];

  @IsOptional()
  @IsArray()
  competitors?: Record<string, unknown>[];

  @IsOptional()
  @IsArray()
  qualificationRules?: Record<string, unknown>[];

  @IsOptional()
  @IsObject()
  messagingSummary?: Record<string, unknown>;
}

export class UpsertPersonaDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  role!: string;

  @IsOptional()
  @IsString()
  seniority?: string | null;

  @IsOptional()
  @IsString()
  function?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  goals?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  pains?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  objections?: string[];

  @IsOptional()
  @IsString()
  buyingInfluence?: string | null;
}

export class UpsertQualificationRuleDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsIn(['positive', 'negative'])
  polarity!: 'positive' | 'negative';

  @IsString()
  field!: string;

  @IsIn(['eq', 'neq', 'in', 'not_in', 'contains', 'gte', 'lte', 'exists'])
  operator!: 'eq' | 'neq' | 'in' | 'not_in' | 'contains' | 'gte' | 'lte' | 'exists';

  @Allow()
  value!: string | number | boolean | string[];

  @IsOptional()
  @IsString()
  label?: string | null;
}

export class PatchMessagingSummaryDto {
  @IsOptional()
  @IsString()
  oneLiner?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  valuePropositions?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  differentiators?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  commonObjections?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  proofPoints?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  themes?: string[];
}
