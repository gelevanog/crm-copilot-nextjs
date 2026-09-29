import { Inject, Injectable, Logger } from '@nestjs/common';
import type { z } from 'zod';
import {
  followUpEmailSchema,
  notesSummarySchema,
  OPEN_DEAL_STAGES,
  parsedFilterSchema,
  type Activity,
  type AiFeature,
  type ChatStreamEvent,
  type ConversationSummary,
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
import { ConversationsService } from './conversations/conversations.service';
import type { TranscriptEntry } from './conversations/transcript';
import { LlmError } from './llm/llm-error';
import {
  addUsage,
  LLM_PROVIDER,
  ZERO_USAGE,
  type LlmProvider,
  type TokenUsage,
} from './llm/llm.types';
import {
  renderTask,
  withValidationFeedback,
  type ActivitySnippet,
  type StructuredTask,
} from './prompts/templates';
import { CrmToolsService } from './tools/crm-tools';
import { UsageService } from './usage/usage.service';

const today = () => new Date().toISOString().slice(0, 10);

/** One retry with the validation issues fed back, for models without native structured outputs. */
const MAX_STRUCTURED_ATTEMPTS = 2;

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
  private readonly contextMaxTokens: number;

  constructor(
    @Inject(LLM_PROVIDER) private readonly provider: LlmProvider,
    @InjectEnv() env: Env,
    tools: CrmToolsService,
    private readonly usage: UsageService,
    private readonly deals: DealsService,
    private readonly companies: CompaniesService,
    private readonly conversations: ConversationsService,
  ) {
    this.agent = new ChatAgent(provider, tools, env.AI_MAX_TOOL_ITERATIONS);
    this.contextMaxTokens = env.AI_CONTEXT_MAX_TOKENS;
  }

  /**
   * Answers `message` in a saved conversation and streams events through
   * `emit`. The question is stored first; the model sees the stored history
   * trimmed to the context budget; the new steps are stored when the run ends,
   * including a closing entry when it fails. Never throws: failures are
   * reported as an `error` event after any partial output.
   */
  async chat(
    user: AuthUser,
    conversation: ConversationSummary,
    message: string,
    emit: (event: ChatStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const started = Date.now();
    let usage: TokenUsage = ZERO_USAGE;
    let model = this.provider.model;
    let toolCalls = 0;
    let errorCode: string | null = null;
    const recorded: TranscriptEntry[] = [];
    emit({ type: 'conversation', id: conversation.id, title: conversation.title });
    try {
      await this.conversations.append(user, conversation.id, [{ role: 'user', text: message }]);
      const history = await this.conversations.modelContext(
        user,
        conversation.id,
        this.contextMaxTokens,
      );
      const result = await this.agent.run(
        {
          ctx: { scope: user, conversationId: conversation.id },
          userName: user.name,
          history,
          signal,
        },
        emit,
        (entry) => recorded.push(entry),
      );
      usage = result.usage;
      toolCalls = result.toolCalls;
      model = result.servedModel ?? model;
      const summary = {
        inputTokens: usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
        outputTokens: usage.outputTokens,
        costUsd: this.usage.costOf(model, usage),
      };
      const last = recorded.at(-1);
      if (last?.role === 'assistant') {
        last.meta = { provider: this.provider.name, model, usage: summary };
      }
      emit({ type: 'done', provider: this.provider.name, model, usage: summary });
    } catch (err) {
      const llmError = err instanceof LlmError ? err : null;
      errorCode = llmError?.code ?? 'internal_error';
      if (llmError) this.logger.warn(`chat failed: ${llmError.code}: ${llmError.message}`);
      else this.logger.error(`chat failed: ${(err as Error).stack ?? String(err)}`);
      const publicMessage =
        llmError?.publicMessage ?? 'Something went wrong while answering. Please try again.';
      recorded.push({
        role: 'assistant',
        text: '',
        toolCalls: [],
        error: { code: errorCode, message: publicMessage },
      });
      emit({ type: 'error', code: errorCode, message: publicMessage });
    } finally {
      await this.conversations
        .append(user, conversation.id, recorded)
        .catch((err: unknown) =>
          this.logger.error(`Failed to save conversation: ${(err as Error).message}`),
        );
      await this.usage.record({
        scope: user,
        feature: 'chat',
        provider: this.provider.name,
        model,
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
   * JSON is only trusted after it passes the shared Zod schema; an invalid
   * answer gets one retry with the validation issues fed back.
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
    let model = this.provider.model;
    let errorCode: string | null = null;
    let prompt = renderTask(task);
    try {
      for (let attempt = 1; ; attempt++) {
        let issues: string[];
        try {
          const result = await this.provider.generateStructured({
            task,
            prompt,
            schema,
            schemaName,
          });
          usage = addUsage(usage, result.usage);
          model = result.servedModel ?? model;
          const parsed = schema.safeParse(result.value);
          if (parsed.success) return parsed.data;
          issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`);
        } catch (err) {
          if (!(err instanceof LlmError && err.code === 'invalid_model_output')) throw err;
          issues = ['the answer was not a JSON object'];
        }
        this.logger.warn(
          `${feature}: model output failed validation (attempt ${attempt}): ${issues.join('; ')}`,
        );
        if (attempt >= MAX_STRUCTURED_ATTEMPTS) {
          throw new LlmError('invalid_model_output', 'Structured output failed schema validation');
        }
        prompt = withValidationFeedback(renderTask(task), issues);
      }
    } catch (err) {
      errorCode = err instanceof LlmError ? err.code : 'internal_error';
      throw err;
    } finally {
      await this.usage.record({
        scope: user,
        feature,
        provider: this.provider.name,
        model,
        usage,
        latencyMs: Date.now() - started,
        success: errorCode === null,
        errorCode,
      });
    }
  }
}
