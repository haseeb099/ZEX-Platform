import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import pino, { Logger } from 'pino';
import { redactSecrets } from '@src/common/redact-secrets';

@Injectable()
export class LoggerService implements NestLoggerService {
  private readonly logger: Logger;

  constructor() {
    const isProd = process.env.NODE_ENV === 'production';
    this.logger = pino({
      level: process.env.LOG_LEVEL || 'info',
      transport: isProd
        ? undefined
        : {
            target: 'pino-pretty',
            options: { colorize: true, singleLine: true },
          },
    });
  }

  log(message: string, context?: string) {
    this.logger.info({ context }, message);
  }

  error(message: string, trace?: string, context?: string) {
    this.logger.error({ context, trace }, message);
  }

  warn(message: string, context?: string) {
    this.logger.warn({ context }, message);
  }

  debug(message: string, context?: string) {
    this.logger.debug({ context }, message);
  }

  verbose(message: string, context?: string) {
    this.logger.trace({ context }, message);
  }

  info(message: string, meta?: Record<string, unknown>, context?: string) {
    const safeMeta = meta ? (redactSecrets(meta) as Record<string, unknown>) : undefined;
    this.logger.info({ context, ...safeMeta }, message);
  }
}
