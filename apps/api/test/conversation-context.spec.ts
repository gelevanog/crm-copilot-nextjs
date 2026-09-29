import type { ProposedActionView } from '@crm/shared';
import { describe, expect, it } from 'vitest';
import { estimateTokens, fitToContextWindow } from '../src/ai/conversations/context-window';
import {
  fromRow,
  titleFromQuestion,
  toChatTurns,
  toModelItems,
  toRow,
  type TranscriptEntry,
} from '../src/ai/conversations/transcript';
import { HISTORY_TRIMMED_NOTE } from '../src/ai/prompts/templates';

const question = (text: string): TranscriptEntry => ({ role: 'user', text });
const answer = (text: string): TranscriptEntry => ({ role: 'assistant', text, toolCalls: [] });

/** One exchange with a tool round: question, tool call, result, answer. */
function toolExchange(n: number, resultChars: number): TranscriptEntry[] {
  return [
    question(`Question ${n}`),
    {
      role: 'assistant',
      text: '',
      toolCalls: [{ id: `call_${n}`, name: 'searchDeals', input: { text: `q${n}` } }],
    },
    {
      role: 'tool_results',
      results: [
        {
          toolCallId: `call_${n}`,
          name: 'searchDeals',
          content: 'x'.repeat(resultChars),
          isError: false,
          summary: 'ok',
        },
      ],
    },
    answer(`Answer ${n}`),
  ];
}

describe('estimateTokens', () => {
  it('counts ~4 characters per token plus a small per-message overhead', () => {
    expect(estimateTokens(question('x'.repeat(400)))).toBe(104);
    const [, call, result] = toolExchange(1, 4000);
    expect(estimateTokens(result!)).toBeGreaterThan(1000);
    expect(estimateTokens(call!)).toBeGreaterThan(estimateTokens(answer('')));
  });
});

describe('fitToContextWindow', () => {
  it('keeps everything when the history fits', () => {
    const entries = [...toolExchange(1, 100), question('Next?')];
    expect(fitToContextWindow(entries, 10_000)).toEqual({ entries, trimmed: false });
  });

  it('drops the oldest whole exchanges first and says so in a note', () => {
    const entries = [...toolExchange(1, 4000), ...toolExchange(2, 4000), question('Latest?')];
    const fitted = fitToContextWindow(entries, 1500);

    expect(fitted.trimmed).toBe(true);
    expect(fitted.entries[0]).toEqual({ role: 'note', text: HISTORY_TRIMMED_NOTE });
    // Exchange 2 (with its tool round intact) and the new question survive.
    expect(fitted.entries.slice(1)).toEqual([...toolExchange(2, 4000), question('Latest?')]);
  });

  it('never splits a tool call from its result and never starts mid-exchange', () => {
    const entries = [...toolExchange(1, 8000), ...toolExchange(2, 200), question('Latest?')];
    const fitted = fitToContextWindow(entries, 1000);
    const kept = fitted.entries.slice(1);

    expect(kept[0]).toEqual(question('Question 2'));
    const calls = kept.flatMap((e) => (e.role === 'assistant' ? e.toolCalls.map((c) => c.id) : []));
    const results = kept.flatMap((e) =>
      e.role === 'tool_results' ? e.results.map((r) => r.toolCallId) : [],
    );
    expect(calls).toEqual(results);
  });

  it('always keeps the newest exchange, even over budget', () => {
    const entries = [...toolExchange(1, 100), question('y'.repeat(40_000))];
    const fitted = fitToContextWindow(entries, 1000);
    expect(fitted.entries.at(-1)).toEqual(question('y'.repeat(40_000)));
    expect(fitted.entries).toHaveLength(2);
  });

  it('adds the note when older rows were not even loaded', () => {
    const fitted = fitToContextWindow([question('Hi')], 1000, { olderOmitted: true });
    expect(fitted.entries.map((e) => e.role)).toEqual(['note', 'user']);
  });
});

describe('transcript mapping', () => {
  it('round-trips entries through the DB row shape and rejects malformed rows', () => {
    const [, call] = toolExchange(1, 10);
    expect(fromRow(toRow(call!))).toEqual(call);
    expect(() => fromRow({ role: 'assistant', content: { text: 1 } })).toThrow();
  });

  it('replays notes as tagged user messages and interrupted answers as assistant text', () => {
    const items = toModelItems([
      question('Move it'),
      {
        role: 'assistant',
        text: '',
        toolCalls: [],
        error: { code: 'aborted', message: 'Stopped' },
      },
      { role: 'note', text: 'The user approved the proposal.' },
    ]);
    expect(items).toEqual([
      { role: 'user', text: 'Move it' },
      { role: 'assistant', text: '[This answer was interrupted: Stopped]', toolCalls: [] },
      { role: 'user', text: '<app_note>\nThe user approved the proposal.\n</app_note>' },
    ]);
  });

  it('groups a stored exchange into chat turns with fresh proposal state', () => {
    const [q, call, results, final] = toolExchange(1, 10);
    const withProposal: TranscriptEntry = {
      role: 'tool_results',
      results: [
        {
          ...(results as Extract<TranscriptEntry, { role: 'tool_results' }>).results[0]!,
          proposalId: 'p1',
        },
      ],
    };
    const proposal = { id: 'p1', status: 'approved' } as ProposedActionView;
    const turns = toChatTurns(
      [q, call, withProposal, final, { role: 'note', text: 'approved' } as const].map(
        (entry, i) => ({ id: `m${i}`, entry: entry! }),
      ),
      new Map([['p1', proposal]]),
    );

    expect(turns).toEqual([
      { id: 'm0', role: 'user', content: 'Question 1' },
      {
        id: 'm1',
        role: 'assistant',
        content: 'Answer 1',
        error: null,
        meta: null,
        tools: [
          {
            id: 'call_1',
            name: 'searchDeals',
            input: { text: 'q1' },
            ok: true,
            summary: 'ok',
            proposal,
          },
        ],
      },
    ]);
  });

  it('titles a conversation from its first question', () => {
    expect(titleFromQuestion('  Move the   Acme deal to Proposal ')).toBe(
      'Move the Acme deal to Proposal',
    );
    const long = titleFromQuestion(
      'Which deals over $20k are stuck in Negotiation for more than two weeks and why?',
    );
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long).toMatch(/^Which deals over \$20k are stuck in Negotiation for more…$/);
  });
});
