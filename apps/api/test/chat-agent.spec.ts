import type { ChatStreamEvent } from '@crm/shared';
import { describe, expect, it, vi } from 'vitest';
import { ChatAgent } from '../src/ai/chat/chat-agent';
import { FakeProvider } from '../src/ai/llm/fake/fake.provider';
import { LlmError } from '../src/ai/llm/llm-error';
import type { LlmProvider, TurnRequest, TurnResult } from '../src/ai/llm/llm.types';
import { ZERO_USAGE } from '../src/ai/llm/llm.types';
import type { ToolOutcome } from '../src/ai/tools/crm-tools';

const ctx = { scope: { workspaceId: 'ws_1', userId: 'user_1' } };

function stubTools(outcome: (name: string, input: unknown) => ToolOutcome) {
  return {
    specs: () => [{ name: 'searchDeals', description: 'search', inputSchema: { type: 'object' } }],
    execute: vi.fn(async (_ctx: unknown, name: string, input: unknown) => outcome(name, input)),
  };
}

/** Provider that replays scripted turns and records what it was sent. */
function scriptedProvider(turns: Partial<TurnResult>[]) {
  const requests: TurnRequest[] = [];
  const provider: LlmProvider = {
    name: 'fake',
    model: 'scripted',
    async runTurn(req) {
      requests.push({ ...req, items: [...req.items] });
      const t = turns[requests.length - 1] ?? { text: 'done' };
      if (t.text) req.onTextDelta(t.text);
      return { text: '', toolCalls: [], stopReason: 'end_turn', usage: ZERO_USAGE, ...t };
    },
    generateStructured: vi.fn(),
  };
  return { provider, requests };
}

async function run(agent: ChatAgent, question: string) {
  const events: ChatStreamEvent[] = [];
  const result = await agent.run(
    { ctx, userName: 'Alex', messages: [{ role: 'user', content: question }] },
    (e) => events.push(e),
  );
  const text = events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
  return { events, result, text };
}

describe('ChatAgent with the fake provider', () => {
  it('runs the full loop: tool call -> scoped execution -> streamed answer', async () => {
    const tools = stubTools(() => ({
      ok: true,
      summary: '1 deal found',
      data: {
        total: 1,
        returned: 1,
        totalAmount: 96000,
        deals: [
          {
            title: 'Claims automation suite',
            company: 'Granite Insurance',
            stage: 'NEGOTIATION',
            amount: 96000,
            daysInStage: 31,
            expectedCloseDate: null,
            owner: 'Alex Morgan',
          },
        ],
      },
    }));
    const agent = new ChatAgent(new FakeProvider(), tools, 5);

    const { events, result, text } = await run(
      agent,
      'Which deals over $20k are stuck in Negotiation for more than 2 weeks?',
    );

    expect(tools.execute).toHaveBeenCalledWith(ctx, 'searchDeals', {
      stages: ['NEGOTIATION'],
      minAmount: 20000,
      stuckForDays: 14,
    });
    expect(events.map((e) => e.type).filter((t) => t !== 'text')).toEqual([
      'tool_call',
      'tool_result',
    ]);
    expect(text).toContain('**Claims automation suite**');
    expect(result).toMatchObject({ toolCalls: 1, iterations: 2 });
    expect(result.usage.inputTokens).toBeGreaterThan(0);
  });

  it('issues parallel tool calls for an account summary and returns all results together', async () => {
    const tools = stubTools((name) =>
      name === 'getCompany'
        ? {
            ok: true,
            summary: 'Acme Logistics',
            data: {
              name: 'Acme Logistics',
              industry: 'Logistics',
              employees: 1200,
              location: 'Chicago, US',
              openDeals: 2,
              openPipeline: 60000,
              lastActivityAt: '2026-09-01',
              contacts: [],
              deals: [],
              recentActivities: [],
            },
          }
        : { ok: true, summary: '0 activities', data: { count: 0, activities: [] } },
    );
    const agent = new ChatAgent(new FakeProvider(), tools, 5);
    const { text } = await run(agent, 'Summarize my last interactions with Acme');

    expect(tools.execute.mock.calls.map((c) => c[1])).toEqual(['getCompany', 'listActivities']);
    expect(text).toContain('**Acme Logistics**');
  });

  it('answers without tools when the question is not about CRM data', async () => {
    const tools = stubTools(() => ({ ok: true, summary: '', data: {} }));
    const { events, text } = await run(new ChatAgent(new FakeProvider(), tools, 5), 'hello');
    expect(tools.execute).not.toHaveBeenCalled();
    expect(events.every((e) => e.type === 'text')).toBe(true);
    expect(text).toContain('I can answer questions');
  });
});

describe('ChatAgent loop guards', () => {
  it('feeds tool errors back to the model instead of failing the request', async () => {
    const { provider, requests } = scriptedProvider([
      {
        toolCalls: [{ id: 't1', name: 'searchDeals', input: { stages: ['CLOSING'] } }],
        stopReason: 'tool_use',
      },
      { text: 'Sorry, that stage does not exist.' },
    ]);
    const tools = stubTools(() => ({
      ok: false,
      summary: 'Invalid arguments',
      data: { error: 'invalid_arguments' },
    }));

    const { events } = await run(new ChatAgent(provider, tools, 5), 'deals in closing');

    const second = requests[1]!.items.at(-1);
    expect(second).toMatchObject({
      role: 'tool_results',
      results: [{ toolCallId: 't1', isError: true }],
    });
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ ok: false });
  });

  it('stops after the iteration budget', async () => {
    const loop = {
      toolCalls: [{ id: 'x', name: 'searchDeals', input: {} }],
      stopReason: 'tool_use' as const,
    };
    const { provider, requests } = scriptedProvider([loop, loop, loop, loop]);
    const tools = stubTools(() => ({ ok: true, summary: '', data: {} }));

    const { result, text } = await run(new ChatAgent(provider, tools, 3), 'loop forever');
    expect(requests).toHaveLength(3);
    expect(result.iterations).toBe(3);
    expect(text).toContain('I stopped after several lookups');
  });

  it('never runs a tool call truncated by max_tokens', async () => {
    const { provider } = scriptedProvider([
      { toolCalls: [{ id: 'x', name: 'searchDeals', input: {} }], stopReason: 'max_tokens' },
    ]);
    const tools = stubTools(() => ({ ok: true, summary: '', data: {} }));
    await expect(run(new ChatAgent(provider, tools, 3), 'q')).rejects.toMatchObject({
      code: 'output_truncated',
    });
    expect(tools.execute).not.toHaveBeenCalled();
  });

  it('surfaces refusals as a typed error', async () => {
    const { provider } = scriptedProvider([{ stopReason: 'refusal' }]);
    const tools = stubTools(() => ({ ok: true, summary: '', data: {} }));
    await expect(run(new ChatAgent(provider, tools, 3), 'q')).rejects.toBeInstanceOf(LlmError);
  });
});
