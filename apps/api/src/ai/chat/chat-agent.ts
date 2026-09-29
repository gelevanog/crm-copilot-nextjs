import type { ChatStreamEvent } from '@crm/shared';
import type { StoredToolResult, TranscriptEntry } from '../conversations/transcript';
import { LlmError } from '../llm/llm-error';
import {
  addUsage,
  ZERO_USAGE,
  type ConversationItem,
  type LlmProvider,
  type TokenUsage,
} from '../llm/llm.types';
import { chatSystemPrompt } from '../prompts/templates';
import type { CrmToolsService, ToolContext } from '../tools/crm-tools';

/** Tool payloads larger than this are truncated before going back to the model. */
const MAX_TOOL_RESULT_CHARS = 12_000;

export interface ChatRunInput {
  ctx: ToolContext;
  userName: string;
  /** Conversation so far, ending with the user's new question. */
  history: ConversationItem[];
  signal?: AbortSignal;
  now?: Date;
}

/**
 * Receives each completed step for persistence: an assistant turn together
 * with all of its tool results, or the final answer. A step is only recorded
 * once it is complete, so a saved transcript never ends with a tool call that
 * has no result.
 */
export type RecordEntry = (entry: TranscriptEntry) => void;

export interface ChatRunResult {
  usage: TokenUsage;
  toolCalls: number;
  iterations: number;
  /** Model that answered the last turn, if the provider reports one (router fallbacks). */
  servedModel?: string;
}

/**
 * Provider-agnostic tool-calling loop:
 *   model turn -> validate + execute tool calls (tenant-scoped) -> feed results back
 * until the model answers without tools or the iteration budget is spent.
 * Every step is surfaced to the caller as a ChatStreamEvent.
 */
export class ChatAgent {
  constructor(
    private readonly provider: LlmProvider,
    private readonly tools: Pick<CrmToolsService, 'specs' | 'execute'>,
    private readonly maxIterations: number,
  ) {}

  async run(
    input: ChatRunInput,
    emit: (event: ChatStreamEvent) => void,
    record: RecordEntry = () => undefined,
  ): Promise<ChatRunResult> {
    const system = chatSystemPrompt({
      userName: input.userName,
      today: (input.now ?? new Date()).toISOString().slice(0, 10),
    });
    const specs = this.tools.specs();
    const items: ConversationItem[] = [...input.history];

    let usage = ZERO_USAGE;
    let toolCalls = 0;
    let servedModel: string | undefined;

    for (let iteration = 1; iteration <= this.maxIterations; iteration++) {
      const turn = await this.provider.runTurn({
        system,
        items,
        tools: specs,
        signal: input.signal,
        onTextDelta: (delta) => emit({ type: 'text', delta }),
      });
      usage = addUsage(usage, turn.usage);
      servedModel = turn.servedModel ?? servedModel;

      if (turn.stopReason === 'refusal') {
        throw new LlmError('model_refused', 'Model refused the chat request');
      }
      if (turn.toolCalls.length === 0) {
        record({ role: 'assistant', text: turn.text, toolCalls: [] });
        return { usage, toolCalls, iterations: iteration, servedModel };
      }
      if (turn.stopReason === 'max_tokens') {
        // A tool call cut off mid-arguments may still parse; never run it.
        throw new LlmError('output_truncated', 'Tool call truncated at max_tokens');
      }

      items.push({
        role: 'assistant',
        text: turn.text,
        toolCalls: turn.toolCalls,
        providerState: turn.providerState,
      });

      // Execute all calls of this turn in parallel and return every result in
      // one message, as both vendor APIs expect.
      const results = await Promise.all(
        turn.toolCalls.map(async (call): Promise<StoredToolResult> => {
          emit({ type: 'tool_call', id: call.id, name: call.name, input: call.input });
          const outcome = await this.tools.execute(input.ctx, call.name, call.input);
          emit({
            type: 'tool_result',
            id: call.id,
            name: call.name,
            ok: outcome.ok,
            summary: outcome.summary,
            ...(outcome.table && { table: outcome.table }),
            ...(outcome.proposal && { proposal: outcome.proposal }),
          });
          return {
            toolCallId: call.id,
            name: call.name,
            content: truncateJson(outcome.data),
            isError: !outcome.ok,
            summary: outcome.summary,
            ...(outcome.table && { table: outcome.table }),
            ...(outcome.proposal && { proposalId: outcome.proposal.id }),
          };
        }),
      );
      toolCalls += results.length;
      items.push({ role: 'tool_results', results });
      record({ role: 'assistant', text: turn.text, toolCalls: turn.toolCalls });
      record({ role: 'tool_results', results });
    }

    const stopped =
      'I stopped after several lookups without reaching a final answer. Please narrow the question.';
    emit({ type: 'text', delta: `\n\n${stopped}` });
    record({ role: 'assistant', text: stopped, toolCalls: [] });
    return { usage, toolCalls, iterations: this.maxIterations, servedModel };
  }
}

function truncateJson(data: unknown): string {
  const json = JSON.stringify(data);
  if (json.length <= MAX_TOOL_RESULT_CHARS) return json;
  return JSON.stringify({
    truncated: true,
    note: 'Result too large; showing the beginning only. Ask a narrower question for details.',
    partial: json.slice(0, MAX_TOOL_RESULT_CHARS),
  });
}
