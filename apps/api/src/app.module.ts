import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ActivitiesModule } from './activities/activities.module';
import { AiModule } from './ai/ai.module';
import { AuthModule } from './auth/auth.module';
import { CompaniesModule } from './companies/companies.module';
import { ConfigModule, ENV } from './config/config.module';
import type { Env } from './config/env';
import { ContactsModule } from './contacts/contacts.module';
import { DealsModule } from './deals/deals.module';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          ...(env.LOG_PRETTY && {
            transport: { target: 'pino-pretty', options: { singleLine: true } },
          }),
          redact: ['req.headers.authorization', 'req.headers.cookie'],
          customProps: (req) => {
            const user = (req as { user?: { userId: string; workspaceId: string } }).user;
            return user ? { userId: user.userId, workspaceId: user.workspaceId } : {};
          },
          autoLogging: { ignore: (req) => req.url === '/health' },
        },
      }),
    }),
    PrismaModule,
    AuthModule,
    CompaniesModule,
    ContactsModule,
    DealsModule,
    ActivitiesModule,
    AiModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
