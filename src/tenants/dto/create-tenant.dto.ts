import { IsNotEmpty, IsOptional, IsString, IsUrl, ValidateIf } from 'class-validator';

/**
 * Create tenant + Twenty connection.
 *
 * Preferred fields: workspaceId, baseUrl, graphqlUrl, restUrl, apiKey, webhookSecret.
 * Legacy aliases twentyWorkspaceId / twentyApiKey remain for transitional clients.
 * baseUrl / graphqlUrl / restUrl are required — endpoints are never inferred.
 * webhookSecret is required and never returned from API responses.
 */
export class CreateTenantDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  /** Preferred: Twenty workspace id for this tenant's CRM deployment. */
  @ValidateIf(o => !o.twentyWorkspaceId)
  @IsString()
  @IsNotEmpty()
  workspaceId?: string;

  /** @deprecated Prefer workspaceId */
  @ValidateIf(o => !o.workspaceId)
  @IsString()
  @IsNotEmpty()
  twentyWorkspaceId?: string;

  @IsUrl({ require_tld: false })
  baseUrl!: string;

  @IsUrl({ require_tld: false })
  graphqlUrl!: string;

  @IsUrl({ require_tld: false })
  restUrl!: string;

  /** Preferred: Twenty API key (encrypted at rest). */
  @ValidateIf(o => !o.twentyApiKey)
  @IsString()
  @IsNotEmpty()
  apiKey?: string;

  /** @deprecated Prefer apiKey */
  @ValidateIf(o => !o.apiKey)
  @IsString()
  @IsNotEmpty()
  twentyApiKey?: string;

  /**
   * Explicit Twenty webhook signing secret (must match the secret configured in Twenty).
   * Encrypted immediately; never returned from API responses; never logged.
   */
  @IsString()
  @IsNotEmpty()
  webhookSecret!: string;

  @IsOptional()
  @IsString()
  twentyVersion?: string;

  @IsOptional()
  @IsString()
  clearbitApiKey?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  publicBaseUrl?: string;
}
