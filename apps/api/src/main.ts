import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';
import { loadEnvironment } from './config/environment';
import { ErrorsFilter } from './common/filters/errors.filter';
async function main(): Promise<void> {
  const env = loadEnvironment();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  const logger = new Logger('HTTP');
  app.use((req: Request, res: Response, next: NextFunction) => {
    const id = randomUUID();
    res.setHeader('x-request-id', id);
    const start = Date.now();
    res.on('finish', () =>
      logger.log(
        JSON.stringify({
          event: 'request',
          requestId: id,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          elapsedMs: Date.now() - start,
        }),
      ),
    );
    next();
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new ErrorsFilter());
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Powerbridge Phase 1')
      .setDescription(
        'Schema approval never applies DDL. Business imports require deployed verified contracts. Cookie sessions; roles enforced server-side.',
      )
      .setVersion('1.0')
      .addCookieAuth('session')
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document);
  app.enableShutdownHooks();
  await app.listen(env.PORT, '0.0.0.0');
}
void main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: 'startup_failed',
      type: error instanceof Error ? error.name : 'Unknown',
    }),
  );
  process.exitCode = 1;
});
