import { describe, expect, it, vi } from 'vitest';
import { AiService } from '../src/ai/ai.service';
import { FakeProvider } from '../src/ai/llm/fake/fake.provider';
import type { LlmProvider } from '../src/ai/llm/llm.types';
import { ZERO_USAGE } from '../src/ai/llm/llm.types';
import type { Env } from '../src/config/env';

const user = { userId: 'u1', workspaceId: 'w1', email: 'a@b.test', name: 'Alex Morgan' };

function makeService(provider: LlmProvider) {
  const usage = { record: vi.fn(async () => 0), costOf: vi.fn(() => 0) };
  const service = new AiService(
    provider,
    { AI_MAX_TOOL_ITERATIONS: 5 } as Env,
    { specs: () => [], execute: vi.fn() } as never,
    usage as never,
    {} as never,
    {} as never,
  );
  return { service, usage };
}

describe('AiService.parseDealFilter (LLM -> validated filter)', () => {
  it('returns a filter that passed the shared schema and logs usage', async () => {
    const { service, usage } = makeService(new FakeProvider());
    const result = await service.parseDealFilter(user, 'negotiation deals over $50k');

    expect(result.filter).toEqual({ stages: ['NEGOTIATION'], minAmount: 50000 });
    expect(result.explanation).toContain('Negotiation');
    expect(usage.record).toHaveBeenCalledWith(
      expect.objectContaining({ feature: 'nl_filter', success: true, errorCode: null }),
    );
  });

  it('rejects model output that does not match the schema and records the failure', async () => {
    const badProvider: LlmProvider = {
      name: 'openai',
      model: 'gpt-5-mini',
      runTurn: vi.fn(),
      generateStructured: vi.fn(async () => ({
        value: { filter: { stages: ['CLOSING'], minAmount: '20k' }, explanation: 'x' },
        usage: { ...ZERO_USAGE, inputTokens: 120, outputTokens: 30 },
      })),
    };
    const { service, usage } = makeService(badProvider);

    await expect(service.parseDealFilter(user, 'deals closing')).rejects.toMatchObject({
      code: 'invalid_model_output',
      httpStatus: 502,
    });
    expect(usage.record).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: 'nl_filter',
        success: false,
        errorCode: 'invalid_model_output',
        usage: expect.objectContaining({ inputTokens: 120 }),
      }),
    );
  });
});
