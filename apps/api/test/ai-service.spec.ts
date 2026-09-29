import type { ChatStreamEvent } from '@crm/shared';
import { describe, expect, it, vi } from 'vitest';
import { AiService } from '../src/ai/ai.service';
import { LlmError } from '../src/ai/llm/llm-error';
import { FakeProvider } from '../src/ai/llm/fake/fake.provider';
import type { LlmProvider } from '../src/ai/llm/llm.types';
import { ZERO_USAGE } from '../src/ai/llm/llm.types';
import type { Env } from '../src/config/env';

const user = { userId: 'u1', workspaceId: 'w1', email: 'a@b.test', name: 'Alex Morgan' };

function makeService(provider: LlmProvider) {
  const usage = { record: vi.fn(async () => 0), costOf: vi.fn(() => 0) };
  const conversations = {
    append: vi.fn(async () => undefined),
    modelContext: vi.fn(async () => [{ role: 'user', text: 'hello' }]),
  };
  const service = new AiService(
    provider,
    { AI_MAX_TOOL_ITERATIONS: 5, AI_CONTEXT_MAX_TOKENS: 24_000 } as Env,
    { specs: () => [], execute: vi.fn() } as never,
    usage as never,
    {} as never,
    {} as never,
    conversations as never,
  );
  return { service, usage, conversations };
}

describe('AiService.chat (saved conversation)', () => {
  const conversation = {
    id: 'c1',
    title: 'Pipeline',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };

  it('stores the question, then the answer with usage metadata', async () => {
    const { service, conversations } = makeService(new FakeProvider());
    const events: ChatStreamEvent[] = [];
    await service.chat(user, conversation, 'hello', (e) => events.push(e));

    expect(events[0]).toEqual({ type: 'conversation', id: 'c1', title: 'Pipeline' });
    expect(conversations.append).toHaveBeenNthCalledWith(1, user, 'c1', [
      { role: 'user', text: 'hello' },
    ]);
    expect(conversations.modelContext).toHaveBeenCalledWith(user, 'c1', 24_000);
    expect(conversations.append).toHaveBeenLastCalledWith(user, 'c1', [
      expect.objectContaining({
        role: 'assistant',
        meta: expect.objectContaining({ provider: 'fake', model: 'fake-rules-v1' }),
      }),
    ]);
  });

  it('closes a failed run with an error entry so the saved history stays replayable', async () => {
    const failing: LlmProvider = {
      name: 'anthropic',
      model: 'claude-sonnet-5',
      runTurn: vi.fn(async () => {
        throw new LlmError('provider_unavailable', 'down');
      }),
      generateStructured: vi.fn(),
    };
    const { service, conversations, usage } = makeService(failing);
    const events: ChatStreamEvent[] = [];
    await service.chat(user, conversation, 'hello', (e) => events.push(e));

    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'provider_unavailable' });
    expect(conversations.append).toHaveBeenLastCalledWith(user, 'c1', [
      {
        role: 'assistant',
        text: '',
        toolCalls: [],
        error: { code: 'provider_unavailable', message: expect.any(String) },
      },
    ]);
    expect(usage.record).toHaveBeenCalledWith(
      expect.objectContaining({ feature: 'chat', success: false }),
    );
  });
});

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

  it('retries once with the validation issues fed back, then accepts a corrected answer', async () => {
    const generateStructured = vi
      .fn()
      .mockResolvedValueOnce({
        value: { filter: { stages: ['CLOSING'] }, explanation: 'x' },
        usage: { ...ZERO_USAGE, inputTokens: 100, outputTokens: 20 },
      })
      .mockResolvedValueOnce({
        value: { filter: { stages: ['NEGOTIATION'] }, explanation: 'Negotiation deals.' },
        usage: { ...ZERO_USAGE, inputTokens: 130, outputTokens: 20 },
        servedModel: 'qwen/qwen3.8-27b:free',
      });
    const sloppy: LlmProvider = {
      name: 'openrouter',
      model: 'nvidia/nemotron-3-super-120b-a12b:free',
      runTurn: vi.fn(),
      generateStructured,
    };
    const { service, usage } = makeService(sloppy);

    await expect(service.parseDealFilter(user, 'deals in negotiation')).resolves.toEqual({
      filter: { stages: ['NEGOTIATION'] },
      explanation: 'Negotiation deals.',
    });
    const retryPrompt = generateStructured.mock.calls[1]![0].prompt.user as string;
    expect(retryPrompt).toContain('Your previous answer was not valid');
    expect(retryPrompt).toContain('filter.stages.0');
    expect(usage.record).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        // Usage adds up across attempts; the model that answered is recorded.
        model: 'qwen/qwen3.8-27b:free',
        usage: expect.objectContaining({ inputTokens: 230 }),
      }),
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
    expect(badProvider.generateStructured).toHaveBeenCalledTimes(2);
    expect(usage.record).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: 'nl_filter',
        success: false,
        errorCode: 'invalid_model_output',
        // Both attempts are accounted for.
        usage: expect.objectContaining({ inputTokens: 240 }),
      }),
    );
  });
});
