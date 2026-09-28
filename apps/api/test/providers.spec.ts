import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { AnthropicProvider } from '../src/ai/llm/anthropic.provider';
import type { ConversationItem, ToolSpec } from '../src/ai/llm/llm.types';
import { OpenAiProvider } from '../src/ai/llm/openai.provider';

/**
 * Drives the real SDK code paths (streaming parsers, message mapping, usage)
 * against recorded-style HTTP responses, so provider adapters are tested
 * without API keys or network access.
 */

type Captured = { url: string; body: Record<string, unknown> };

function mockFetch(responses: (() => Response)[]) {
  const calls: Captured[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    const next = responses[calls.length - 1];
    if (!next) throw new Error('unexpected request');
    return next();
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function sse(events: { event?: string; data: unknown }[]): () => Response {
  const body = events
    .map(
      (e) =>
        `${e.event ? `event: ${e.event}\n` : ''}data: ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}\n\n`,
    )
    .join('');
  return () =>
    new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function json(data: unknown, status = 200): () => Response {
  return () =>
    new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

const tools: ToolSpec[] = [
  {
    name: 'searchDeals',
    description: 'Search deals',
    inputSchema: { type: 'object', properties: {} },
  },
];

const firstTurn: ConversationItem[] = [{ role: 'user', text: 'Deals in negotiation?' }];

describe('OpenAiProvider', () => {
  const chunk = (
    delta: Record<string, unknown>,
    finish: string | null = null,
    usage?: unknown,
  ) => ({
    data: {
      id: 'c1',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'gpt-5-mini',
      choices: [{ index: 0, delta, finish_reason: finish }],
      ...(usage ? { usage } : {}),
    },
  });

  it('accumulates streamed tool-call fragments and maps the tool loop back to chat messages', async () => {
    const { fetchImpl, calls } = mockFetch([
      sse([
        chunk({
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'call_1',
              type: 'function',
              function: { name: 'searchDeals', arguments: '' },
            },
          ],
        }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: '{"stages":["NEGO' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: 'TIATION"]}' } }] }, 'tool_calls'),
        {
          data: {
            id: 'c1',
            object: 'chat.completion.chunk',
            created: 0,
            model: 'gpt-5-mini',
            choices: [],
            usage: { prompt_tokens: 120, completion_tokens: 18, total_tokens: 138 },
          },
        },
        { data: '[DONE]' },
      ]),
      sse([
        chunk({ content: 'Two deals ' }),
        chunk({ content: 'are in negotiation.' }, 'stop'),
        { data: '[DONE]' },
      ]),
    ]);
    const provider = new OpenAiProvider({
      apiKey: 'test',
      model: 'gpt-5-mini',
      maxOutputTokens: 512,
      timeoutMs: 5000,
      fetch: fetchImpl,
    });

    const turn1 = await provider.runTurn({
      system: 'sys',
      items: firstTurn,
      tools,
      onTextDelta: () => undefined,
    });
    expect(turn1).toMatchObject({
      stopReason: 'tool_use',
      toolCalls: [{ id: 'call_1', name: 'searchDeals', input: { stages: ['NEGOTIATION'] } }],
      usage: { inputTokens: 120, outputTokens: 18 },
    });
    expect(calls[0]!.body).toMatchObject({
      model: 'gpt-5-mini',
      stream: true,
      tools: [{ type: 'function', function: { name: 'searchDeals' } }],
    });

    const deltas: string[] = [];
    const turn2 = await provider.runTurn({
      system: 'sys',
      tools,
      onTextDelta: (d) => deltas.push(d),
      items: [
        ...firstTurn,
        { role: 'assistant', text: '', toolCalls: turn1.toolCalls },
        {
          role: 'tool_results',
          results: [
            { toolCallId: 'call_1', name: 'searchDeals', content: '{"total":2}', isError: false },
          ],
        },
      ],
    });
    expect(deltas.join('')).toBe('Two deals are in negotiation.');
    expect(turn2.stopReason).toBe('end_turn');
    expect(calls[1]!.body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'Deals in negotiation?' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'searchDeals', arguments: '{"stages":["NEGOTIATION"]}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"total":2}' },
    ]);
  });

  it('requests json_schema structured output and maps auth errors', async () => {
    const schema = z.object({ subject: z.string() });
    const { fetchImpl, calls } = mockFetch([
      json({
        id: 'c2',
        object: 'chat.completion',
        created: 0,
        model: 'gpt-5-mini',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: '{"subject":"Hi"}', refusal: null },
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55 },
      }),
      json({ error: { message: 'bad key', type: 'invalid_request_error' } }, 401),
    ]);
    const provider = new OpenAiProvider({
      apiKey: 'test',
      model: 'gpt-5-mini',
      maxOutputTokens: 512,
      timeoutMs: 5000,
      fetch: fetchImpl,
    });
    const req = {
      task: { kind: 'nl_filter' as const, context: { text: 'x', today: '2026-01-01' } },
      prompt: { system: 's', user: 'u' },
      schema,
      schemaName: 'email',
    };

    await expect(provider.generateStructured(req)).resolves.toMatchObject({
      value: { subject: 'Hi' },
    });
    expect(calls[0]!.body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'email' },
    });
    await expect(provider.generateStructured(req)).rejects.toMatchObject({ code: 'provider_auth' });
  });
});

describe('AnthropicProvider', () => {
  const ev = (type: string, data: Record<string, unknown>) => ({
    event: type,
    data: { type, ...data },
  });

  it('streams text, collects tool_use blocks and echoes the full content on the next turn', async () => {
    const { fetchImpl, calls } = mockFetch([
      sse([
        ev('message_start', {
          message: {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            model: 'claude-sonnet-5',
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: {
              input_tokens: 200,
              output_tokens: 1,
              cache_read_input_tokens: 150,
              cache_creation_input_tokens: 0,
            },
          },
        }),
        ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
        ev('content_block_delta', {
          index: 0,
          delta: { type: 'text_delta', text: 'Checking the pipeline.' },
        }),
        ev('content_block_stop', { index: 0 }),
        ev('content_block_start', {
          index: 1,
          content_block: { type: 'tool_use', id: 'toolu_1', name: 'searchDeals', input: {} },
        }),
        ev('content_block_delta', {
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"stages": ["NEGO' },
        }),
        ev('content_block_delta', {
          index: 1,
          delta: { type: 'input_json_delta', partial_json: 'TIATION"]}' },
        }),
        ev('content_block_stop', { index: 1 }),
        ev('message_delta', {
          delta: { stop_reason: 'tool_use', stop_sequence: null },
          usage: { output_tokens: 42 },
        }),
        ev('message_stop', {}),
      ]),
    ]);
    const provider = new AnthropicProvider({
      apiKey: 'test',
      model: 'claude-sonnet-5',
      effort: 'medium',
      maxOutputTokens: 1024,
      timeoutMs: 5000,
      fetch: fetchImpl,
    });

    const deltas: string[] = [];
    const turn = await provider.runTurn({
      system: 'sys',
      items: firstTurn,
      tools,
      onTextDelta: (d) => deltas.push(d),
    });

    expect(deltas.join('')).toBe('Checking the pipeline.');
    expect(turn).toMatchObject({
      stopReason: 'tool_use',
      toolCalls: [{ id: 'toolu_1', name: 'searchDeals', input: { stages: ['NEGOTIATION'] } }],
      usage: { inputTokens: 200, outputTokens: 42, cacheReadTokens: 150 },
    });
    expect(calls[0]!.body).toMatchObject({
      model: 'claude-sonnet-5',
      stream: true,
      system: 'sys',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      tools: [{ name: 'searchDeals', eager_input_streaming: true }],
    });

    // The next request must carry the assistant content verbatim plus one user
    // message with every tool_result.
    const { fetchImpl: fetch2, calls: calls2 } = mockFetch([
      sse([
        ev('message_start', {
          message: {
            id: 'msg_2',
            type: 'message',
            role: 'assistant',
            model: 'claude-sonnet-5',
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 1 },
          },
        }),
        ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
        ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Done.' } }),
        ev('content_block_stop', { index: 0 }),
        ev('message_delta', {
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 3 },
        }),
        ev('message_stop', {}),
      ]),
    ]);
    const provider2 = new AnthropicProvider({
      apiKey: 'test',
      model: 'claude-sonnet-5',
      effort: 'medium',
      maxOutputTokens: 1024,
      timeoutMs: 5000,
      fetch: fetch2,
    });
    await provider2.runTurn({
      system: 'sys',
      tools,
      onTextDelta: () => undefined,
      items: [
        ...firstTurn,
        {
          role: 'assistant',
          text: turn.text,
          toolCalls: turn.toolCalls,
          providerState: turn.providerState,
        },
        {
          role: 'tool_results',
          results: [
            { toolCallId: 'toolu_1', name: 'searchDeals', content: '{"total":2}', isError: false },
          ],
        },
      ],
    });
    const messages = calls2[0]!.body.messages as { role: string; content: unknown }[];
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Checking the pipeline.' },
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'searchDeals',
          input: { stages: ['NEGOTIATION'] },
        },
      ],
    });
    expect(messages[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"total":2}', is_error: false },
      ],
    });
  });

  it('maps rate limits to a typed, retryable error', async () => {
    const limited = json(
      { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } },
      429,
    );
    const { fetchImpl } = mockFetch([limited, limited, limited]);
    const provider = new AnthropicProvider({
      apiKey: 'test',
      model: 'claude-sonnet-5',
      effort: 'low',
      maxOutputTokens: 256,
      timeoutMs: 5000,
      fetch: fetchImpl,
    });
    // The SDK retries 429s itself (maxRetries: 2) before surfacing the error.
    await expect(
      provider.runTurn({ system: 's', items: firstTurn, tools, onTextDelta: () => undefined }),
    ).rejects.toMatchObject({ code: 'provider_rate_limited' });
  }, 20_000);
});
