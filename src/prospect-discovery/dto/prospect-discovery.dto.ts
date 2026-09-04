import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class StartProspectDiscoveryDto {
  @IsString()
  companyBrainId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsBoolean()
  sync?: boolean;
}
