import * as Joi from 'joi';

export const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug', 'trace').default('info'),
  DATABASE_URL: Joi.string().required(),
  DATABASE_LOGGING: Joi.boolean().truthy('true').falsy('false').default(false),
  REDIS_URL: Joi.string().required(),
  MASTER_KEY: Joi.string().length(64).required(),
  JWT_SECRET: Joi.string().min(32).required(),
  TWENTY_GRAPHQL_URL: Joi.string().uri().default('https://api.twenty.com/graphql'),
  CLEARBIT_API_KEY: Joi.string().allow('').optional(),
  APOLLO_API_KEY: Joi.string().allow('').optional(),
  HUNTER_API_KEY: Joi.string().allow('').optional(),
  SENTRY_DSN: Joi.string().allow('').optional(),
  OTEL_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
  FEATURE_AUTO_OPPORTUNITY: Joi.boolean().truthy('true').falsy('false').default(true),
  FEATURE_BATCH_SCORING: Joi.boolean().truthy('true').falsy('false').default(false),
  ADMIN_API_KEY: Joi.string().min(8).required(),
  WEBHOOK_RATE_LIMIT: Joi.number().default(1000),
});
