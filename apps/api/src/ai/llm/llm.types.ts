import type { z } from 'zod';
import type { RenderedPrompt, StructuredTask } from '../prompts/templates';

/**
 * Provider-neutral contract between the AI features and an LLM vendor.
 *
 * The agent loop, tool execution, validation, rate limiting and usage
 * accounting all live outside the provider, so switching between OpenAI,
 * Anthropic and the deterministic fake provider is a config change.
 */

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema generated from the tool's Zod input schema. */
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Raw, unvalidated arguments as produced by the model. */
  input: unknown;
}

export interface ToolResultItem {
  toolCallId: string;
  name: string;
  /** JSON string handed back to the model. */
  content: string;
  isError: boolean;
}

export type ConversationItem =
  | { role: 'user'; text: string }
  | {
      role: 'assistant';
      text: string;
      toolCalls: ToolCall[];
      /**
       * Opaque provider-native content (e.g. Anthropic thinking + tool_use
       * blocks) that must be echoed back unchanged within a tool loop.
       */
      providerState?: unknown;
    }
  | { role: 'tool_results'; results: ToolResultItem[] };

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';

export interface TurnRequest {
  system: string;
  items: ConversationItem[];
  tools: ToolSpec[];
  onTextDelta: (delta: string) => void;
  signal?: AbortSignal;
}

export interface TurnResult {
  text: string;
  toolCalls: ToolCall[];
  stopReason: StopReason;
  usage: TokenUsage;
  providerState?: unknown;
}

export interface StructuredRequest<T> {
  /** Typed task + context. Real providers use `prompt`; the fake provider uses `task`. */
  task: StructuredTask;
  prompt: RenderedPrompt;
  schema: z.ZodType<T>;
  schemaName: string;
  signal?: AbortSignal;
}

export interface StructuredResult {
  /** Unvalidated JSON value; callers validate it against the Zod schema. */
  value: unknown;
  usage: TokenUsage;
}

export interface LlmProvider {
  readonly name: 'openai' | 'anthropic' | 'fake';
  readonly model: string;
  /** One model turn: streams text deltas and returns any requested tool calls. */
  runTurn(request: TurnRequest): Promise<TurnResult>;
  /** Single request constrained to a JSON schema (structured outputs). */
  generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult>;
}

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
