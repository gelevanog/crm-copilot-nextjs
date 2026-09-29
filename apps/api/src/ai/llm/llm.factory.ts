import type { Env } from '../../config/env';
import { AnthropicProvider } from './anthropic.provider';
import { FakeProvider } from './fake/fake.provider';
import type { LlmProvider } from './llm.types';
import { OpenAiProvider } from './openai.provider';
import { ThrottledProvider } from './throttle';

/** Selects the LLM implementation from `LLM_PROVIDER`. Keys are validated in env.ts. */
export function createLlmProvider(env: Env): LlmProvider {
  const provider = createBaseProvider(env);
  return env.LLM_MIN_REQUEST_INTERVAL_MS > 0
    ? new ThrottledProvider(provider, env.LLM_MIN_REQUEST_INTERVAL_MS)
    : provider;
}

function createBaseProvider(env: Env): LlmProvider {
  switch (env.LLM_PROVIDER) {
    case 'anthropic':
      return new AnthropicProvider({
        apiKey: env.ANTHROPIC_API_KEY ?? '',
        model: env.ANTHROPIC_MODEL,
        effort: env.ANTHROPIC_EFFORT,
        maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
        timeoutMs: env.LLM_TIMEOUT_MS,
        maxRetries: env.LLM_MAX_RETRIES,
      });
    case 'openai':
      return new OpenAiProvider({
        apiKey: env.OPENAI_API_KEY ?? '',
        model: env.OPENAI_MODEL,
        baseURL: env.OPENAI_BASE_URL,
        maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
        timeoutMs: env.LLM_TIMEOUT_MS,
        maxRetries: env.LLM_MAX_RETRIES,
      });
    case 'openrouter':
      return new OpenAiProvider({
        name: 'openrouter',
        apiKey: env.OPENROUTER_API_KEY ?? '',
        model: env.OPENROUTER_MODEL,
        fallbackModels: env.OPENROUTER_FALLBACK_MODELS,
        baseURL: env.OPENROUTER_BASE_URL,
        defaultHeaders: {
          ...(env.OPENROUTER_APP_URL && { 'HTTP-Referer': env.OPENROUTER_APP_URL }),
          ...(env.OPENROUTER_APP_TITLE && { 'X-Title': env.OPENROUTER_APP_TITLE }),
        },
        maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
        timeoutMs: env.LLM_TIMEOUT_MS,
        maxRetries: env.LLM_MAX_RETRIES,
      });
    case 'fake':
      return new FakeProvider({ chunkDelayMs: env.NODE_ENV === 'test' ? 0 : 15 });
  }
}
