import { Inject, Injectable, Logger } from '@nestjs/common';
import type { z } from 'zod';
import {
  followUpEmailSchema,
  notesSummarySchema,
  OPEN_DEAL_STAGES,
  parsedFilterSchema,
  type Activity,
  type AiFeature,
  type ChatMessage,
  type ChatStreamEvent,
  type DealStage,
  type EmailTone,
  type FollowUpEmail,
  type NotesSummary,
  type ParsedFilter,
} from '@crm/shared';
import type { AuthUser } from '../common/auth-user';
import { InjectEnv } from '../config/config.module';
import type { Env } from '../config/env';
import { CompaniesService } from '../companies/companies.service';
import { DealsService } from '../deals/deals.service';
import { ChatAgent } from './chat/chat-agent';
import { LlmError } from './llm/llm-error';
import { LLM_PROVIDER, ZERO_USAGE, type LlmProvider, type TokenUsage } from './llm/llm.types';
import { renderTask, type ActivitySnippet, type StructuredTask } from './prompts/templates';
import { CrmToolsService } from './tools/crm-tools';
import { UsageService } from './usage/usage.service';

const today = () => new Date().toISOString().slice(0, 10);

function toSnippet(a: Activity, maxBody = 600): ActivitySnippet {
  return {
    type: a.type,
    date: a.occurredAt.slice(0, 10),
    subject: a.subject,
    body: a.body && a.body.length > maxBody ? `${a.body.slice(0, maxBody)}…` : a.body,
  };
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly agent: ChatAgent;

  constructor(
    @Inject(LLM_PROVIDER) private readonly provider: LlmProvider,
    @InjectEnv() env: Env,
    tools: CrmToolsService,
    private readonly usage: UsageService,
    private readonly deals: DealsService,
    private readonly companies: CompaniesService,
  ) {
    this.agent = new ChatAgent(provider, tools, env.AI_MAX_TOOL_ITERATIONS);
  }

  /**
   * Runs the copilot chat and streams events through `emit`. Never throws:
   * failures are reported as an `error` event after any partial output.
   */
  async chat(
    user: AuthUser,
    messages: ChatMessage[],
    emit: (event: ChatStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const started = Date.now();
    let usage: TokenUsage = ZERO_USAGE;
    let toolCalls = 0;
    let errorCode: string | null = null;
    try {
      const result = await this.agent.run(
        { ctx: { scope: user }, userName: user.name, messages, signal },
        emit,
      );
      usage = result.usage;
      toolCalls = result.toolCalls;
      emit({
        type: 'done',
        provider: this.provider.name,
        model: this.provider.model,
        usage: {
          inputTokens: usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
          outputTokens: usage.outputTokens,
          costUsd: this.usage.costOf(this.provider.model, usage),
        },
      });
    } catch (err) {
      const llmError = err instanceof LlmError ? err : null;
      errorCode = llmError?.code ?? 'internal_error';
      if (!llmError) this.logger.error(`chat failed: ${(err as Error).stack ?? String(err)}`);
      emit({
        type: 'error',
        code: errorCode,
        message:
          llmError?.publicMessage ?? 'Something went wrong while answering. Please try again.',
      });
    } finally {
      await this.usage.record({
        scope: user,
        feature: 'chat',
        provider: this.provider.name,
        model: this.provider.model,
        usage,
        latencyMs: Date.now() - started,
        toolCalls,
        success: errorCode === null,
        errorCode,
      });
    }
  }

  async draftFollowUp(user: AuthUser, dealId: string, tone: EmailTone): Promise<FollowUpEmail> {
    const deal = await this.deals.findOne(user, dealId);
    return this.structured(user, 'follow_up_email', followUpEmailSchema, 'follow_up_email', {
      kind: 'follow_up_email',
      context: {
        tone,
        today: today(),
        senderName: user.name,
        deal: {
          title: deal.title,
          amount: deal.amount,
          stage: deal.stage,
          daysInStage: deal.daysInStage,
          expectedCloseDate: deal.expectedCloseDate?.slice(0, 10) ?? null,
        },
        company: { name: deal.company.name, industry: null },
        contact: deal.contact
          ? {
              firstName: deal.contact.firstName,
              lastName: deal.contact.lastName,
              title: deal.contact.title,
            }
          : null,
        recentActivities: deal.activities.slice(0, 5).map((a) => toSnippet(a)),
      },
    });
  }

  async summarizeCompany(user: AuthUser, companyId: string): Promise<NotesSummary> {
    const company = await this.companies.findOne(user, companyId);
    const open = OPEN_DEAL_STAGES as readonly DealStage[];
    return this.structured(user, 'notes_summary', notesSummarySchema, 'notes_summary', {
      kind: 'notes_summary',
      context: {
        today: today(),
        company: { name: company.name, industry: company.industry, employees: company.employees },
        openDeals: company.deals
          .filter((d) => open.includes(d.stage))
          .map((d) => ({
            title: d.title,
            amount: d.amount,
            stage: d.stage,
            daysInStage: d.daysInStage,
          })),
        activities: company.activities.slice(0, 15).map((a) => toSnippet(a)),
      },
    });
  }

  parseDealFilter(user: AuthUser, text: string): Promise<ParsedFilter> {
    return this.structured(user, 'nl_filter', parsedFilterSchema, 'deal_filter', {
      kind: 'nl_filter',
      context: { text, today: today() },
    });
  }

  /**
   * Structured-output call with validation and usage accounting. The model's
   * JSON is only trusted after it passes the shared Zod schema.
   */
  private async structured<S extends z.ZodType>(
    user: AuthUser,
    feature: AiFeature,
    schema: S,
    schemaName: string,
    task: StructuredTask,
  ): Promise<z.infer<S>> {
    const started = Date.now();
    let usage: TokenUsage = ZERO_USAGE;
    let errorCode: string | null = null;
    try {
      const result = await this.provider.generateStructured({
        task,
        prompt: renderTask(task),
        schema,
        schemaName,
      });
      usage = result.usage;
      const parsed = schema.safeParse(result.value);
      if (!parsed.success) {
        this.logger.warn(
          `${feature}: model output failed validation: ${parsed.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ')}`,
        );
        throw new LlmError('invalid_model_output', 'Structured output failed schema validation');
      }
      return parsed.data;
    } catch (err) {
      errorCode = err instanceof LlmError ? err.code : 'internal_error';
      throw err;
    } finally {
      await this.usage.record({
        scope: user,
        feature,
        provider: this.provider.name,
        model: this.provider.model,
        usage,
        latencyMs: Date.now() - started,
        success: errorCode === null,
        errorCode,
      });
    }
  }
}
