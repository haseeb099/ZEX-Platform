import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { LoggerService } from './common/logger/logger.service';
import { setupSwagger } from './swagger';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
    { bufferLogs: true },
  );

  const logger = app.get(LoggerService);
  app.useLogger(logger);

  await app.init();

  // Replace JSON parser so webhook HMAC can use the exact raw body
  const instance = app.getHttpAdapter().getInstance();
  instance.removeContentTypeParser('application/json');
  instance.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
      try {
        const raw = Buffer.isBuffer(body) ? body.toString('utf8') : String(body ?? '');
        (req as { rawBody?: string }).rawBody = raw;
        done(null, raw.length ? JSON.parse(raw) : {});
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  setupSwagger(app);

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`Application running on http://localhost:${port}`, 'Bootstrap');
}

bootstrap().catch(err => {
  // eslint-disable-next-line no-console
  console.error('Failed to start application', err);
  process.exit(1);
});
