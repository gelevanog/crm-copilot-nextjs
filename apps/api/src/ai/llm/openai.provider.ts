import OpenAI from 'openai';
import type {
  ChatCompletionChunk,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { parseModelJson } from './json-output';
import { toJsonSchema } from './json-schema';
import { LlmError } from './llm-error';
import type {
  ConversationItem,
  LlmProvider,
  StopReason,
  StructuredRequest,
  StructuredResult,
  TokenUsage,
  ToolCall,
  TurnRequest,
  TurnResult,
} from './llm.types';
import { ZERO_USAGE } from './llm.types';

export interface OpenAiProviderOptions {
  /** `openrouter` targets OpenRouter's OpenAI-compatible API (same wire format). */
  name?: 'openai' | 'openrouter';
  apiKey: string;
  model: string;
  baseURL?: string;
  maxOutputTokens: number;
  timeoutMs: number;
  /** SDK retries for rate limits and transient failures. */
  maxRetries: number;
  /** Sent with every request, e.g. OpenRouter's HTTP-Referer and X-Title attribution. */
  defaultHeaders?: Record<string, string>;
  /** OpenRouter only: models tried in order when the primary one fails or is rate limited. */
  fallbackModels?: string[];
  /** Custom fetch (used by tests to replay recorded HTTP streams). */
  fetch?: typeof fetch;
}

/** OpenRouter extension of the Chat Completions body. */
interface RouterParams {
  models?: string[];
}

/**
 * OpenAI Chat Completions adapter. Also serves OpenRouter, which speaks the
 * same protocol and adds model fallbacks; there the response names the model
 * that actually answered, which is reported as `servedModel`.
 */
export class OpenAiProvider implements LlmProvider {
  readonly name: 'openai' | 'openrouter';
  readonly model: string;
  private readonly client: OpenAI;
  private readonly routing: RouterParams;

  constructor(private readonly opts: OpenAiProviderOptions) {
    this.name = opts.name ?? 'openai';
    this.model = opts.model;
    this.routing = opts.fallbackModels?.length
      ? { models: [opts.model, ...opts.fallbackModels] }
      : {};
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      timeout: opts.timeoutMs,
      maxRetries: opts.maxRetries,
      ...(opts.defaultHeaders && { defaultHeaders: opts.defaultHeaders }),
      ...(opts.fetch && { fetch: opts.fetch }),
    });
  }

  /** Only a router can answer with a different model than the one requested. */
  private served(model: string | undefined): string | undefined {
    return this.name === 'openrouter' && model ? model : undefined;
  }

  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const tools: ChatCompletionTool[] = req.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));

    const params: ChatCompletionCreateParamsStreaming & RouterParams = {
      model: this.model,
      messages: toOpenAiMessages(req.system, req.items),
      tools,
      tool_choice: 'auto',
      max_completion_tokens: this.opts.maxOutputTokens,
      stream: true,
      stream_options: { include_usage: true },
      ...this.routing,
    };
    try {
      const stream = await this.client.chat.completions.create(params, { signal: req.signal });

      let text = '';
      let servedModel: string | undefined;
      let finishReason: ChatCompletionChunk.Choice['finish_reason'] = null;
      let usage: TokenUsage = ZERO_USAGE;
      // Tool call arguments arrive as JSON fragments keyed by index.
      const partialCalls = new Map<number, { id: string; name: string; args: string }>();

      for await (const chunk of stream) {
        if (chunk.model) servedModel = chunk.model;
        if (chunk.usage) {
          usage = {
            inputTokens:
              chunk.usage.prompt_tokens - (chunk.usage.prompt_tokens_details?.cached_tokens ?? 0),
            outputTokens: chunk.usage.completion_tokens,
            cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
            cacheWriteTokens: 0,
          };
        }
        const choice = chunk.choices[0];
        if (!choice) continue;
        if (choice.delta.content) {
          text += choice.delta.content;
          req.onTextDelta(choice.delta.content);
        }
        for (const delta of choice.delta.tool_calls ?? []) {
          const entry = partialCalls.get(delta.index) ?? { id: '', name: '', args: '' };
          if (delta.id) entry.id = delta.id;
          if (delta.function?.name) entry.name += delta.function.name;
          if (delta.function?.arguments) entry.args += delta.function.arguments;
          partialCalls.set(delta.index, entry);
        }
        if (choice.finish_reason) finishReason = choice.finish_reason;
      }

      const toolCalls: ToolCall[] = [...partialCalls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, c]) => ({ id: c.id, name: c.name, input: parseArguments(c.args) }));

      return {
        text,
        toolCalls,
        stopReason: mapFinishReason(finishReason),
        usage,
        ...(this.served(servedModel) && { servedModel }),
      };
    } catch (err) {
      throw mapOpenAiError(err);
    }
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult> {
    const params: ChatCompletionCreateParamsNonStreaming & RouterParams = {
      model: this.model,
      messages: [
        { role: 'system', content: req.prompt.system },
        { role: 'user', content: req.prompt.user },
      ],
      max_completion_tokens: this.opts.maxOutputTokens,
      // `strict: false` because our schemas use optional fields, which strict
      // mode does not allow. The Zod schema is the real guarantee: the caller
      // validates the result before using it.
      response_format: {
        type: 'json_schema',
        json_schema: { name: req.schemaName, schema: toJsonSchema(req.schema), strict: false },
      },
      ...this.routing,
    };
    try {
      const completion = await this.client.chat.completions.create(params, {
        signal: req.signal,
      });
      const choice = completion.choices[0];
      if (choice?.message.refusal) {
        throw new LlmError('model_refused', choice.message.refusal);
      }
      if (choice?.finish_reason === 'length') {
        throw new LlmError('output_truncated', 'OpenAI structured output hit the token limit');
      }
      const u = completion.usage;
      return {
        value: parseModelJson(choice?.message.content ?? ''),
        usage: u
          ? {
              inputTokens: u.prompt_tokens - (u.prompt_tokens_details?.cached_tokens ?? 0),
              outputTokens: u.completion_tokens,
              cacheReadTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
              cacheWriteTokens: 0,
            }
          : ZERO_USAGE,
        ...(this.served(completion.model) && { servedModel: completion.model }),
      };
    } catch (err) {
      throw mapOpenAiError(err);
    }
  }
}

function toOpenAiMessages(system: string, items: ConversationItem[]): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [{ role: 'system', content: system }];
  for (const item of items) {
    switch (item.role) {
      case 'user':
        messages.push({ role: 'user', content: item.text });
        break;
      case 'assistant':
        messages.push({
          role: 'assistant',
          content: item.text || null,
          ...(item.toolCalls.length > 0 && {
            tool_calls: item.toolCalls.map((c) => ({
              id: c.id,
              type: 'function' as const,
              function: { name: c.name, arguments: JSON.stringify(c.input) },
            })),
          }),
        });
        break;
      case 'tool_results':
        for (const r of item.results) {
          messages.push({ role: 'tool', tool_call_id: r.toolCallId, content: r.content });
        }
        break;
    }
  }
  return messages;
}

/** Invalid JSON is passed through as a marker; Zod validation then reports it to the model. */
function parseArguments(raw: string): unknown {
  if (raw.trim() === '') return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { __invalid_json__: raw };
  }
}

function mapFinishReason(reason: ChatCompletionChunk.Choice['finish_reason']): StopReason {
  switch (reason) {
    case 'stop':
      return 'end_turn';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'refusal';
    default:
      return 'other';
  }
}

function mapOpenAiError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  if (err instanceof OpenAI.APIUserAbortError)
    return new LlmError('aborted', 'Request aborted', { cause: err });
  if (err instanceof OpenAI.AuthenticationError || err instanceof OpenAI.PermissionDeniedError) {
    return new LlmError('provider_auth', err.message, { cause: err });
  }
  if (err instanceof OpenAI.RateLimitError) {
    return new LlmError('provider_rate_limited', err.message, { cause: err });
  }
  if (err instanceof OpenAI.BadRequestError || err instanceof OpenAI.NotFoundError) {
    return new LlmError('provider_bad_request', err.message, { cause: err });
  }
  if (err instanceof OpenAI.APIError) {
    return new LlmError('provider_unavailable', err.message, { cause: err });
  }
  return new LlmError('provider_unavailable', err instanceof Error ? err.message : String(err), {
    cause: err,
  });
}
