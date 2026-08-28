export type EnrichmentResult = {
  personEmail?: string | null;
  companyName?: string | null;
  companyDomain?: string | null;
  companySize?: string | null;
  industry?: string | null;
  location?: string | null;
  jobTitle?: string | null;
  jobFunction?: string | null;
  technologies?: string[];
  source: string;
  confidence: number;
};

export interface EnrichmentProvider {
  readonly name: string;
  enrich(input: {
    email?: string | null;
    domain?: string | null;
    apiKey?: string | null;
  }): Promise<EnrichmentResult | null>;
}
