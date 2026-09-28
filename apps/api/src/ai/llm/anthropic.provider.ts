import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { Logger } from '@nestjs/common';
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

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  effort: 'low' | 'medium' | 'high';
  maxOutputTokens: number;
  timeoutMs: number;
  /** Custom fetch (used by tests to replay recorded HTTP streams). */
  fetch?: typeof fetch;
}

/** Max consecutive re-issues of a turn whose streamed tool input was not parseable JSON. */
const MAX_JSON_RETRIES = 2;

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic' as const;
  readonly model: string;
  private readonly client: Anthropic;
  private readonly logger = new Logger(AnthropicProvider.name);

  constructor(private readonly opts: AnthropicProviderOptions) {
    this.model = opts.model;
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      timeout: opts.timeoutMs,
      maxRetries: 2,
      ...(opts.fetch && { fetch: opts.fetch }),
    });
  }

  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const tools: Anthropic.Tool[] = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
      // Stream tool arguments as they are generated. The API no longer
      // validates them, which is fine: every input is validated with Zod
      // before a tool runs.
      eager_input_streaming: true,
    }));
    const messages = toAnthropicMessages(req.items);

    for (let attempt = 0; ; attempt++) {
      const stream = this.client.messages.stream(
        {
          model: this.model,
          max_tokens: this.opts.maxOutputTokens,
          system: req.system,
          tools,
          messages,
          thinking: { type: 'adaptive' },
          output_config: { effort: this.opts.effort },
          // Caches the tools + system prefix, which is resent on every loop iteration.
          cache_control: { type: 'ephemeral' },
        },
        { signal: req.signal },
      );
      stream.on('text', (delta) => req.onTextDelta(delta));

      let message: Anthropic.Message;
      try {
        message = await stream.finalMessage();
      } catch (err) {
        // With eager input streaming, a tool input that is not valid JSON
        // rejects finalMessage() with a non-API error. Re-issue the turn.
        if (!(err instanceof Anthropic.APIError) && !isAbort(err) && attempt < MAX_JSON_RETRIES) {
          this.logger.warn(
            `Unparseable streamed tool input (attempt ${attempt + 1}), re-issuing turn`,
          );
          continue;
        }
        throw mapAnthropicError(err);
      }

      const toolCalls: ToolCall[] = message.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
        .map((b) => ({ id: b.id, name: b.name, input: b.input }));
      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');

      return {
        text,
        toolCalls,
        stopReason: mapStopReason(message.stop_reason),
        usage: toUsage(message.usage),
        // Echo the full content (including thinking blocks) on the next turn.
        providerState: message.content,
      };
    }
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult> {
    try {
      const response = await this.client.messages.parse(
        {
          model: this.model,
          max_tokens: this.opts.maxOutputTokens,
          system: req.prompt.system,
          messages: [{ role: 'user', content: req.prompt.user }],
          thinking: { type: 'adaptive' },
          output_config: { effort: 'low', format: zodOutputFormat(req.schema) },
        },
        { signal: req.signal },
      );
      if (response.stop_reason === 'refusal') {
        throw new LlmError('model_refused', 'Anthropic refused the structured request');
      }
      if (response.stop_reason === 'max_tokens') {
        throw new LlmError('output_truncated', 'Anthropic structured output hit max_tokens');
      }
      return { value: response.parsed_output, usage: toUsage(response.usage) };
    } catch (err) {
      throw mapAnthropicError(err);
    }
  }
}

function toAnthropicMessages(items: ConversationItem[]): Anthropic.MessageParam[] {
  return items.map((item): Anthropic.MessageParam => {
    switch (item.role) {
      case 'user':
        return { role: 'user', content: item.text };
      case 'assistant': {
        if (Array.isArray(item.providerState)) {
          return { role: 'assistant', content: item.providerState as Anthropic.ContentBlock[] };
        }
        const blocks: Anthropic.ContentBlockParam[] = [];
        if (item.text) blocks.push({ type: 'text', text: item.text });
        for (const call of item.toolCalls) {
          blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
        }
        return { role: 'assistant', content: blocks.length ? blocks : item.text };
      }
      case 'tool_results':
        // All results of one turn go back in a single user message.
        return {
          role: 'user',
          content: item.results.map((r) => ({
            type: 'tool_result' as const,
            tool_use_id: r.toolCallId,
            content: r.content,
            is_error: r.isError,
          })),
        };
    }
  });
}

function mapStopReason(reason: Anthropic.StopReason | null): StopReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end_turn';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      return 'other';
  }
}

function toUsage(usage: Anthropic.Usage): TokenUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

function isAbort(err: unknown): boolean {
  return err instanceof Anthropic.APIUserAbortError;
}

/** Most specific first; keeps retryable and non-retryable failures distinct. */
function mapAnthropicError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  if (err instanceof Anthropic.APIUserAbortError)
    return new LlmError('aborted', 'Request aborted', { cause: err });
  if (
    err instanceof Anthropic.AuthenticationError ||
    err instanceof Anthropic.PermissionDeniedError
  ) {
    return new LlmError('provider_auth', err.message, { cause: err });
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new LlmError('provider_rate_limited', err.message, { cause: err });
  }
  if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.NotFoundError) {
    return new LlmError('provider_bad_request', err.message, { cause: err });
  }
  if (err instanceof Anthropic.APIConnectionError || err instanceof Anthropic.InternalServerError) {
    return new LlmError('provider_unavailable', err.message, { cause: err });
  }
  if (err instanceof Anthropic.APIError) {
    return new LlmError('provider_unavailable', err.message, { cause: err });
  }
  // messages.parse() throws a plain error when the output fails schema parsing.
  return new LlmError('invalid_model_output', err instanceof Error ? err.message : String(err), {
    cause: err,
  });
}
