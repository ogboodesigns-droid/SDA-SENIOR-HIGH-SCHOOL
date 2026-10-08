import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { config } from './config';

/** Shared by main.ts and the e2e tests so both run the same middleware. */
export function configureApp(app: INestApplication) {
  const express = app as NestExpressApplication;
  const c = config();
  express.set('trust proxy', c.TRUST_PROXY_HOPS);
  express.disable('x-powered-by');
  express.use(helmet());
  express.useBodyParser('json', { limit: '1mb' });
  express.enableCors({
    origin: c.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  express.setGlobalPrefix('api/v1', { exclude: ['health'] });
  express.enableShutdownHooks();
}
