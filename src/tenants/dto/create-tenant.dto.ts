import { IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  twentyWorkspaceId!: string;

  @IsString()
  @IsNotEmpty()
  twentyApiKey!: string;

  @IsOptional()
  @IsString()
  clearbitApiKey?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  publicBaseUrl?: string;
}
