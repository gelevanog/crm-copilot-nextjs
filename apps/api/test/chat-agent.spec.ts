import type { ChatStreamEvent, ProposedActionView } from '@crm/shared';
import { describe, expect, it, vi } from 'vitest';
import { ChatAgent } from '../src/ai/chat/chat-agent';
import type { TranscriptEntry } from '../src/ai/conversations/transcript';
import { FakeProvider } from '../src/ai/llm/fake/fake.provider';
import { LlmError } from '../src/ai/llm/llm-error';
import type {
  ConversationItem,
  LlmProvider,
  TurnRequest,
  TurnResult,
} from '../src/ai/llm/llm.types';
import { ZERO_USAGE } from '../src/ai/llm/llm.types';
import type { ToolOutcome } from '../src/ai/tools/crm-tools';

const ctx = { scope: { workspaceId: 'ws_1', userId: 'user_1' }, conversationId: 'conv_1' };

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

async function run(agent: ChatAgent, question: string, earlier: ConversationItem[] = []) {
  const events: ChatStreamEvent[] = [];
  const recorded: TranscriptEntry[] = [];
  const result = await agent.run(
    { ctx, userName: 'Alex', history: [...earlier, { role: 'user', text: question }] },
    (e) => events.push(e),
    (entry) => recorded.push(entry),
  );
  const text = events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
  return { events, result, text, recorded };
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

    const { events, result, text, recorded } = await run(
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

    // Each completed step is handed over for persistence, with UI metadata.
    expect(recorded.map((e) => e.role)).toEqual(['assistant', 'tool_results', 'assistant']);
    expect(recorded[1]).toMatchObject({
      role: 'tool_results',
      results: [{ name: 'searchDeals', isError: false, summary: '1 deal found' }],
    });
    expect(recorded[2]).toMatchObject({ role: 'assistant', toolCalls: [] });
  });

  it('sends the earlier conversation to the model before the new question', async () => {
    const { provider, requests } = scriptedProvider([{ text: 'Yes, still Negotiation.' }]);
    const tools = stubTools(() => ({ ok: true, summary: '', data: {} }));
    const earlier: ConversationItem[] = [
      { role: 'user', text: 'What stage is Fleet telematics in?' },
      { role: 'assistant', text: 'Negotiation.', toolCalls: [] },
    ];

    await run(new ChatAgent(provider, tools, 5), 'Is it still there?', earlier);

    expect(requests[0]!.items).toEqual([...earlier, { role: 'user', text: 'Is it still there?' }]);
  });

  it('surfaces a write tool proposal in the stream and records only its id', async () => {
    const proposal = {
      id: 'prop_1',
      kind: 'deal_stage_change',
      status: 'pending',
      title: 'Move deal to Proposal',
    } as ProposedActionView;
    const tools = stubTools(() => ({
      ok: true,
      summary: 'Proposed: Move deal to Proposal',
      proposal,
      data: {
        status: 'pending_approval',
        title: 'Move deal to Proposal',
        target: 'Fleet telematics rollout · Acme Logistics',
        changes: [{ field: 'stage', before: 'Negotiation', after: 'Proposal' }],
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        note: 'Nothing has been changed yet.',
      },
    }));
    const agent = new ChatAgent(new FakeProvider(), tools, 5);

    const { events, text, recorded } = await run(agent, 'Move the Acme deal to Proposal');

    expect(tools.execute).toHaveBeenCalledWith(ctx, 'proposeDealStageChange', {
      deal: 'Acme',
      stage: 'PROPOSAL',
    });
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ proposal });
    expect(recorded[1]).toMatchObject({ results: [{ proposalId: 'prop_1' }] });
    expect(text).toContain('Nothing has been changed yet');
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

    const { result, text, recorded } = await run(new ChatAgent(provider, tools, 3), 'loop forever');
    expect(requests).toHaveLength(3);
    expect(result.iterations).toBe(3);
    expect(text).toContain('I stopped after several lookups');
    // The saved transcript still ends with a closed assistant turn.
    expect(recorded.at(-1)).toMatchObject({ role: 'assistant', toolCalls: [] });
  });

  it('never runs a tool call truncated by max_tokens', async () => {
    const { provider } = scriptedProvider([
      { toolCalls: [{ id: 'x', name: 'searchDeals', input: {} }], stopReason: 'max_tokens' },
    ]);
    const tools = stubTools(() => ({ ok: true, summary: '', data: {} }));
    const recorded: TranscriptEntry[] = [];
    await expect(
      new ChatAgent(provider, tools, 3).run(
        { ctx, userName: 'Alex', history: [{ role: 'user', text: 'q' }] },
        () => undefined,
        (e) => recorded.push(e),
      ),
    ).rejects.toMatchObject({ code: 'output_truncated' });
    expect(tools.execute).not.toHaveBeenCalled();
    expect(recorded).toEqual([]);
  });

  it('surfaces refusals as a typed error', async () => {
    const { provider } = scriptedProvider([{ stopReason: 'refusal' }]);
    const tools = stubTools(() => ({ ok: true, summary: '', data: {} }));
    await expect(run(new ChatAgent(provider, tools, 3), 'q')).rejects.toBeInstanceOf(LlmError);
  });
});
