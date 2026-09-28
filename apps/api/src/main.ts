import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { ENV } from './config/config.module';
import { loadDotEnvFile, type Env } from './config/env';

async function bootstrap(): Promise<void> {
  loadDotEnvFile();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const env = app.get<Env>(ENV);
  app.useLogger(app.get(Logger));
  app.enableCors({ origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()) });
  app.enableShutdownHooks();
  await app.listen(env.PORT, '0.0.0.0');
  app.get(Logger).log(`API listening on :${env.PORT} (LLM_PROVIDER=${env.LLM_PROVIDER})`);
}

void bootstrap();
