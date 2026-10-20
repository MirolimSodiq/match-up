import './instrument'; // birinchi bo'lishi shart: .env + Sentry (boshqa modullardan oldin)
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule, configureApp } from './app.module';
import { ENV, type Env } from './config/env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app);
  const env = app.get<Env>(ENV);
  await app.listen(env.PORT);
}

void bootstrap();
