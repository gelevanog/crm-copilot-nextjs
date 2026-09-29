import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ActivitiesModule } from '../activities/activities.module';
import { CompaniesModule } from '../companies/companies.module';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { DealsModule } from '../deals/deals.module';
import { ProposedActionsController } from './actions/proposed-actions.controller';
import { ProposedActionsService } from './actions/proposed-actions.service';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { ConversationsController } from './conversations/conversations.controller';
import { ConversationsService } from './conversations/conversations.service';
import { LlmErrorFilter } from './llm-error.filter';
import { createLlmProvider } from './llm/llm.factory';
import { LLM_PROVIDER } from './llm/llm.types';
import { AI_RATE_LIMITER, AiRateLimitGuard } from './rate-limit/ai-rate-limit.guard';
import { TokenBucketRateLimiter } from './rate-limit/token-bucket';
import { CrmToolsService } from './tools/crm-tools';
import { UsageService } from './usage/usage.service';

@Module({
  imports: [DealsModule, CompaniesModule, ActivitiesModule],
  controllers: [AiController, ConversationsController, ProposedActionsController],
  providers: [
    AiService,
    ConversationsService,
    ProposedActionsService,
    CrmToolsService,
    UsageService,
    AiRateLimitGuard,
    { provide: APP_FILTER, useClass: LlmErrorFilter },
    { provide: LLM_PROVIDER, inject: [ENV], useFactory: (env: Env) => createLlmProvider(env) },
    {
      provide: AI_RATE_LIMITER,
      inject: [ENV],
      useFactory: (env: Env) =>
        new TokenBucketRateLimiter({
          capacity: env.AI_RATE_LIMIT_CAPACITY,
          refillPerMinute: env.AI_RATE_LIMIT_REFILL_PER_MINUTE,
        }),
    },
  ],
})
export class AiModule {}
