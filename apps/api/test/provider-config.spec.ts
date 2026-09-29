import { describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../src/config/env';
import { parseModelJson } from '../src/ai/llm/json-output';
import { createLlmProvider } from '../src/ai/llm/llm.factory';
import type { LlmProvider, TurnRequest } from '../src/ai/llm/llm.types';
import { ZERO_USAGE } from '../src/ai/llm/llm.types';
import { estimateCostUsd } from '../src/ai/llm/pricing';
import { ThrottledProvider } from '../src/ai/llm/throttle';

const base = { DATABASE_URL: 'postgresql://x', JWT_SECRET: 'x'.repeat(16) };

describe('OpenRouter configuration', () => {
  it('requires a key and parses the fallback list', () => {
    expect(() => loadEnv({ ...base, LLM_PROVIDER: 'openrouter' })).toThrow(/OPENROUTER_API_KEY/);
    const env = loadEnv({
      ...base,
      LLM_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: 'sk-or-test',
      OPENROUTER_FALLBACK_MODELS: ' google/gemma-4-31b-it:free , qwen/qwen3.8-27b:free ',
    });
    expect(env.OPENROUTER_MODEL).toBe('nvidia/nemotron-3-super-120b-a12b:free');
    expect(env.OPENROUTER_FALLBACK_MODELS).toEqual([
      'google/gemma-4-31b-it:free',
      'qwen/qwen3.8-27b:free',
    ]);
    expect(createLlmProvider(env)).toMatchObject({
      name: 'openrouter',
      model: 'nvidia/nemotron-3-super-120b-a12b:free',
    });
  });

  it('rejects more fallbacks than OpenRouter accepts (3 models per request)', () => {
    expect(() =>
      loadEnv({
        ...base,
        LLM_PROVIDER: 'openrouter',
        OPENROUTER_API_KEY: 'sk-or-test',
        OPENROUTER_FALLBACK_MODELS: 'a,b,c',
      }),
    ).toThrow(/at most 2 fallback models/);
  });

  it('prices ":free" models at zero', () => {
    expect(estimateCostUsd('google/gemma-4-31b-it:free', { ...ZERO_USAGE, inputTokens: 1e6 })).toBe(
      0,
    );
  });
});

describe('parseModelJson', () => {
  it.each([
    ['{"a":1}'],
    ['```json\n{"a":1}\n```'],
    ['Sure! Here is the result: {"a":1} Hope this helps.'],
  ])('accepts %j', (content) => {
    expect(parseModelJson(content)).toEqual({ a: 1 });
  });

  it('rejects content without JSON as invalid model output', () => {
    expect(() => parseModelJson('I cannot do that')).toThrow(
      expect.objectContaining({ code: 'invalid_model_output' }),
    );
  });
});

describe('ThrottledProvider', () => {
  it('spaces requests by the minimum interval, in call order', async () => {
    const started: number[] = [];
    const inner: LlmProvider = {
      name: 'openrouter',
      model: 'm',
      runTurn: vi.fn(async () => {
        started.push(Date.now());
        return { text: '', toolCalls: [], stopReason: 'end_turn' as const, usage: ZERO_USAGE };
      }),
      generateStructured: vi.fn(async () => {
        started.push(Date.now());
        return { value: {}, usage: ZERO_USAGE };
      }),
    };
    const throttled = new ThrottledProvider(inner, 40);
    const req = { system: '', items: [], tools: [], onTextDelta: () => undefined } as TurnRequest;

    await Promise.all([
      throttled.runTurn(req),
      throttled.runTurn(req),
      throttled.generateStructured({} as never),
    ]);

    expect(throttled).toMatchObject({ name: 'openrouter', model: 'm' });
    expect(started[1]! - started[0]!).toBeGreaterThanOrEqual(35);
    expect(started[2]! - started[1]!).toBeGreaterThanOrEqual(35);
  });
});
