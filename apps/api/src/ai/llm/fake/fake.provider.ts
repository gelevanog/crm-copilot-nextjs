import type { DealFilter, PipelineStats } from '@crm/shared';
import { parseAppNote } from '../../prompts/templates';
import type {
  GetCompanyData,
  ListActivitiesData,
  ProposalToolData,
  SearchDealsData,
} from '../../tools/crm-tools';
import type {
  ConversationItem,
  LlmProvider,
  StructuredRequest,
  StructuredResult,
  TokenUsage,
  ToolCall,
  TurnRequest,
  TurnResult,
} from '../llm.types';
import {
  answerCompany,
  answerFromNote,
  answerPipeline,
  answerProposals,
  answerSearchDeals,
  describeToolError,
  HELP_ANSWER,
  writeFollowUpEmail,
  writeNotesSummary,
} from './fake-writers';
import { extractCompanyName, parseDealFilterRules } from './rule-filter-parser';
import { planWriteCall } from './write-intents';

export interface FakeProviderOptions {
  /** Delay between streamed chunks, to make the demo feel like a real model. */
  chunkDelayMs?: number;
}

/**
 * A deterministic stand-in for an LLM. It routes the user's question with
 * keyword rules, emits the same tool calls a real model would, and writes a
 * templated answer from the tool results. It exercises exactly the same agent
 * loop, validation and accounting code paths as the real providers, which is
 * what makes the app demoable and the tests reproducible without API keys.
 */
export class FakeProvider implements LlmProvider {
  readonly name = 'fake' as const;
  readonly model = 'fake-rules-v1';

  constructor(private readonly opts: FakeProviderOptions = {}) {}

  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const last = req.items[req.items.length - 1];
    const turnIndex = req.items.filter((i) => i.role === 'assistant').length;

    let text = '';
    let toolCalls: ToolCall[] = [];

    if (last?.role === 'user') {
      const note = asksForOutcome(last.text) ? latestAppNote(req.items) : undefined;
      if (note) {
        text = answerFromNote(note);
      } else {
        toolCalls = planToolCalls(last.text).map((c, i) => ({
          ...c,
          id: `call_${turnIndex}_${i}`,
        }));
        if (toolCalls.length === 0) text = HELP_ANSWER;
      }
    } else if (last?.role === 'tool_results') {
      text = composeAnswer(req.items);
    }

    await this.stream(text, req);
    return {
      text,
      toolCalls,
      stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
      usage: estimateUsage(
        req.system + JSON.stringify(req.items) + JSON.stringify(req.tools),
        text + JSON.stringify(toolCalls),
      ),
    };
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult> {
    const task = req.task;
    let value: unknown;
    switch (task.kind) {
      case 'nl_filter':
        value = parseDealFilterRules(task.context.text);
        break;
      case 'follow_up_email':
        value = writeFollowUpEmail(task.context);
        break;
      case 'notes_summary':
        value = writeNotesSummary(task.context);
        break;
    }
    return {
      value,
      usage: estimateUsage(req.prompt.system + req.prompt.user, JSON.stringify(value)),
    };
  }

  private async stream(text: string, req: TurnRequest): Promise<void> {
    const chunks = text.match(/\S+\s*|\s+/g) ?? [];
    for (let i = 0; i < chunks.length; i += 3) {
      if (req.signal?.aborted) return;
      req.onTextDelta(chunks.slice(i, i + 3).join(''));
      if (this.opts.chunkDelayMs) await sleep(this.opts.chunkDelayMs);
    }
  }
}

type PlannedCall = Omit<ToolCall, 'id'>;

/** Keyword router: which tools would a sensible model call for this question? */
export function planToolCalls(question: string): PlannedCall[] {
  const write = planWriteCall(question);
  if (write) return [write];

  const q = question.toLowerCase();
  const company = extractCompanyName(question) ?? extractLowercaseCompany(q);
  const asksDeals =
    /\b(deals?|opportunit|stuck|stalled|closing|negotiation|proposal|qualified|leads?)\b/.test(q);
  const asksInteractions =
    /\b(interactions?|activit|notes?|history|touchpoints?|emails?|calls?|meetings?|happened|summari[sz]e|recap)\b/.test(
      q,
    );
  const asksPipeline =
    /\b(pipeline|forecast|stats|statistics|win rate|overview|how are we doing)\b/.test(q);
  const asksCompany = /\b(tell me about|who is|what do we know|account|company|contacts?)\b/.test(
    q,
  );

  if (company && asksInteractions) {
    return [
      { name: 'getCompany', input: { name: company } },
      { name: 'listActivities', input: { companyName: company, limit: 5 } },
    ];
  }
  if (asksDeals) {
    return [{ name: 'searchDeals', input: parseDealFilterRules(question).filter }];
  }
  if (asksPipeline) {
    return [
      { name: 'getPipelineStats', input: /\b(my|mine)\b/.test(q) ? { ownedByMe: true } : {} },
    ];
  }
  if (company && (asksCompany || q.split(/\s+/).length <= 4)) {
    return [{ name: 'getCompany', input: { name: company } }];
  }
  return [];
}

/** "Did that go through?", "Was the change applied?" */
function asksForOutcome(question: string): boolean {
  return /\b(did|has|have|was|is)\b.*\b(go(ne)? through|applied|approved|rejected|done|happen(ed)?)\b/i.test(
    question,
  );
}

/** The most recent application note in the history (e.g. a proposal outcome). */
function latestAppNote(items: ConversationItem[]): string | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    const note = item?.role === 'user' ? parseAppNote(item.text) : null;
    if (note) return note;
  }
  return undefined;
}

function extractLowercaseCompany(q: string): string | undefined {
  const m = /\b(?:with|about|for|at)\s+([a-z][\w&.-]*(?:\s+[a-z][\w&.-]*)?)\s*[?.!]?$/.exec(
    q.trim(),
  );
  return m?.[1];
}

/** Builds the final answer from the latest assistant tool calls and their results. */
function composeAnswer(items: ConversationItem[]): string {
  const results = items[items.length - 1];
  const assistant = items[items.length - 2];
  if (results?.role !== 'tool_results' || assistant?.role !== 'assistant') return HELP_ANSWER;

  const byName = new Map<string, { input: unknown; data: unknown; isError: boolean }>();
  for (const r of results.results) {
    const call = assistant.toolCalls.find((c) => c.id === r.toolCallId);
    byName.set(r.name, {
      input: call?.input,
      data: JSON.parse(r.content) as unknown,
      isError: r.isError,
    });
  }

  const failed = [...byName.values()].find((r) => r.isError);
  if (failed) return describeToolError(failed.data as Parameters<typeof describeToolError>[0]);

  const proposals = [...byName.entries()]
    .filter(([name]) => name.startsWith('propose'))
    .map(([, r]) => r.data as ProposalToolData);
  if (proposals.length > 0) return answerProposals(proposals);

  const company = byName.get('getCompany');
  if (company) {
    const activities = byName.get('listActivities');
    return answerCompany(
      company.data as GetCompanyData,
      activities?.data as ListActivitiesData | undefined,
    );
  }
  const deals = byName.get('searchDeals');
  if (deals) return answerSearchDeals(deals.data as SearchDealsData, deals.input as DealFilter);
  const stats = byName.get('getPipelineStats');
  if (stats) return answerPipeline(stats.data as PipelineStats);
  return HELP_ANSWER;
}

function estimateUsage(input: string, output: string): TokenUsage {
  return {
    inputTokens: Math.ceil(input.length / 4),
    outputTokens: Math.ceil(output.length / 4),
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
