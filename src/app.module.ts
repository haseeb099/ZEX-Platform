import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_PIPE } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { AuditModule } from './audit/audit.module';
import { CommonModule } from './common/common.module';
import { LoggerModule } from './common/logger/logger.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { CompanyBrainModule } from './company-brain/company-brain.module';
import { envSchema } from './config/env.schema';
import { EnrichmentModule } from './enrichment/enrichment.module';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { ScoringModule } from './scoring/scoring.module';
import { TenantsModule } from './tenants/tenants.module';
import { TwentyModule } from './twenty/twenty.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: envSchema,
      validationOptions: { abortEarly: false },
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.getOrThrow<string>('REDIS_URL'),
        },
      }),
    }),
    LoggerModule,
    PrismaModule,
    CommonModule,
    HealthModule,
    TwentyModule,
    TenantsModule,
    WebhooksModule,
    JobsModule,
    EnrichmentModule,
    ScoringModule,
    AuditModule,
    CompanyBrainModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    },
  ],
})
export class AppModule {}
