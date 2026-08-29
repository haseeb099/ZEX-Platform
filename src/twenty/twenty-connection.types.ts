/**
 * Runtime Twenty connection for a tenant.
 * Contains decrypted secrets for in-process use only — never log or return via HTTP.
 */
export type ResolvedTwentyConnection = {
  tenantId: string;
  workspaceId: string;
  baseUrl: string;
  graphqlUrl: string;
  restUrl: string;
  apiKey: string;
  webhookSecret?: string;
  twentyVersion?: string | null;
};
