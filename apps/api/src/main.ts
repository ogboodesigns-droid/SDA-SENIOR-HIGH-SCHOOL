import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap-app';
import { config } from './config';

async function bootstrap() {
  const c = config();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configureApp(app);
  await app.listen(c.PORT);
  new Logger('Bootstrap').log(`SDA SHS API listening on port ${c.PORT}`);
}

void bootstrap();
