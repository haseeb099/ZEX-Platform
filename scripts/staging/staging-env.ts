/** Required environment variables for pinned Twenty staging validation. */
export const STAGING_ENV_KEYS = [
  'STAGING_TWENTY_BASE_URL',
  'STAGING_TWENTY_GRAPHQL_URL',
  'STAGING_TWENTY_REST_URL',
  'STAGING_TWENTY_WORKSPACE_ID',
  'STAGING_TWENTY_API_KEY',
  'STAGING_TWENTY_WEBHOOK_SECRET',
  'STAGING_PLATFORM_BASE_URL',
  'STAGING_PLATFORM_ADMIN_API_KEY',
] as const;

export type StagingEnv = Record<(typeof STAGING_ENV_KEYS)[number], string>;

export function loadStagingEnv(): StagingEnv {
  const missing = STAGING_ENV_KEYS.filter(key => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing required staging env: ${missing.join(', ')}. See docs/STAGING_RUNBOOK.md`,
    );
  }

  return STAGING_ENV_KEYS.reduce((acc, key) => {
    acc[key] = process.env[key]!.trim();
    return acc;
  }, {} as StagingEnv);
}

export function optionalStagingEnv(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value || undefined;
}
