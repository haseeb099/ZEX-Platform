import * as Joi from 'joi';

export const envSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'staging', 'production')
    .default('development'),
  PORT: Joi.number().default(3000),
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug', 'trace').default('info'),
  DATABASE_URL: Joi.string().required(),
  DATABASE_LOGGING: Joi.boolean().truthy('true').falsy('false').default(false),
  REDIS_URL: Joi.string().required(),
  MASTER_KEY: Joi.string()
    .pattern(/^[0-9a-fA-F]{64}$/)
    .required(),
  JWT_SECRET: Joi.string().min(32).required(),
  /**
   * @deprecated Not used for tenant CRM calls. Per-tenant TwentyConnection.graphqlUrl is authoritative.
   * Kept optional for local bootstrap / transitional tooling only.
   */
  TWENTY_GRAPHQL_URL: Joi.string().uri().optional(),
  CLEARBIT_API_KEY: Joi.string().allow('').optional(),
  APOLLO_API_KEY: Joi.string().allow('').optional(),
  HUNTER_API_KEY: Joi.string().allow('').optional(),
  SENTRY_DSN: Joi.string().allow('').optional(),
  OTEL_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
  FEATURE_AUTO_OPPORTUNITY: Joi.boolean().truthy('true').falsy('false').default(true),
  FEATURE_BATCH_SCORING: Joi.boolean().truthy('true').falsy('false').default(false),
  /**
   * Explicit opt-in: allow EnrichAndScoreProcessor to use webhook person snapshot when GetPerson fails.
   * Default false — production/staging must not hide CRM read failures.
   */
  ALLOW_TWENTY_SNAPSHOT_FALLBACK: Joi.boolean().truthy('true').falsy('false').default(false),
  /** Staging-only: return deterministic enrichment (no Clearbit/Apollo/Hunter). */
  STAGING_DETERMINISTIC_ENRICHMENT: Joi.boolean().truthy('true').falsy('false').default(false),
  /**
   * Optional overrides for enrich-and-score job attempts/backoff (defaults: 5 / 2000ms).
   * Contract tests may set attempts=1 for terminal CRM failure assertions without changing defaults.
   */
  BULLMQ_ENRICH_ATTEMPTS: Joi.number().integer().min(1).max(20).optional(),
  BULLMQ_ENRICH_BACKOFF_MS: Joi.number().integer().min(1).optional(),
  ADMIN_API_KEY: Joi.string().min(32).required(),
  WEBHOOK_RATE_LIMIT: Joi.number().default(1000),
  /** Force deterministic Company Brain analyzer (also default in NODE_ENV=test). */
  COMPANY_BRAIN_DETERMINISTIC: Joi.boolean().truthy('true').falsy('false').default(false),
  PROSPECT_DISCOVERY_DETERMINISTIC: Joi.boolean().truthy('true').falsy('false').default(false),
  /** Force deterministic Why-Now signal provider (also preferred in NODE_ENV=test). */
  WHY_NOW_DETERMINISTIC: Joi.boolean().truthy('true').falsy('false').default(false),
  /** Force deterministic Research Agent provider (also preferred in NODE_ENV=test). */
  RESEARCH_AGENT_DETERMINISTIC: Joi.boolean().truthy('true').falsy('false').default(false),
  /** Optional future LLM credentials — unused by deterministic analyzer. */
  OPENAI_API_KEY: Joi.string().allow('').optional(),
});
