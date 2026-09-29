import { z } from 'zod';
import type { ChatTurn, ProposedActionView, ResultTable, ToolActivityView } from '@crm/shared';
import type { ConversationItem } from '../llm/llm.types';
import { appNote } from '../prompts/templates';

/**
 * Persisted transcript entries (`ConversationMessage.role` + `content`).
 *
 * They are provider-neutral on purpose: the stored history is text, tool
 * calls and tool results, never vendor-native blocks. Within one request the
 * agent still echoes provider state (e.g. Anthropic thinking blocks) back
 * unchanged, but earlier turns are replayed without it. That keeps a
 * conversation resumable after switching providers, and keeps trimming the
 * oldest turns valid, since thinking blocks are bound to the exact prefix they
 * were produced with.
 */

const toolCallSchema = z.object({ id: z.string(), name: z.string(), input: z.unknown() });

const storedToolResultSchema = z.object({
  toolCallId: z.string(),
  name: z.string(),
  /** JSON string that was handed to the model. */
  content: z.string(),
  isError: z.boolean(),
  /** UI chip line and table, so a saved conversation re-renders as it streamed. */
  summary: z.string(),
  table: z.custom<ResultTable>((v) => typeof v === 'object' && v !== null).optional(),
  proposalId: z.string().optional(),
});

const usageSummarySchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  costUsd: z.number(),
});

export const transcriptEntrySchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('user'), text: z.string() }),
  z.object({
    role: z.literal('assistant'),
    text: z.string(),
    toolCalls: z.array(toolCallSchema),
    /** Set on the entry that closes a run which failed or was stopped. */
    error: z.object({ code: z.string(), message: z.string() }).optional(),
    /** Set on the last entry of a successful run. */
    meta: z
      .object({ provider: z.string(), model: z.string(), usage: usageSummarySchema })
      .optional(),
  }),
  z.object({ role: z.literal('tool_results'), results: z.array(storedToolResultSchema) }),
  /** Application-authored context, e.g. the outcome of a proposal. */
  z.object({ role: z.literal('note'), text: z.string() }),
]);

export type TranscriptEntry = z.infer<typeof transcriptEntrySchema>;
export type StoredToolResult = z.infer<typeof storedToolResultSchema>;
export type AssistantEntry = Extract<TranscriptEntry, { role: 'assistant' }>;

/** Splits an entry into the DB columns (`role` is its own enum column). */
export function toRow(entry: TranscriptEntry): { role: TranscriptEntry['role']; content: object } {
  const { role, ...content } = entry;
  return { role, content };
}

export function fromRow(row: { role: string; content: unknown }): TranscriptEntry {
  return transcriptEntrySchema.parse({ ...(row.content as object), role: row.role });
}

/** Maps stored entries to the provider-neutral items the agent loop sends to a model. */
export function toModelItems(entries: TranscriptEntry[]): ConversationItem[] {
  return entries.map((entry): ConversationItem => {
    switch (entry.role) {
      case 'user':
        return { role: 'user', text: entry.text };
      case 'note':
        return { role: 'user', text: appNote(entry.text) };
      case 'assistant': {
        const interrupted = entry.error
          ? `[This answer was interrupted: ${entry.error.message}]`
          : '';
        const text = [entry.text, interrupted].filter(Boolean).join('\n\n');
        return {
          role: 'assistant',
          text: text || (entry.toolCalls.length > 0 ? '' : '[No answer]'),
          toolCalls: entry.toolCalls,
        };
      }
      case 'tool_results':
        return {
          role: 'tool_results',
          results: entry.results.map((r) => ({
            toolCallId: r.toolCallId,
            name: r.name,
            content: r.content,
            isError: r.isError,
          })),
        };
    }
  });
}

/**
 * Groups stored entries into chat turns for the UI: everything between two
 * user messages is one assistant turn (text, tool chips, proposal cards).
 * Notes are context for the model and are not rendered.
 */
export function toChatTurns(
  rows: { id: string; entry: TranscriptEntry }[],
  proposals: ReadonlyMap<string, ProposedActionView>,
): ChatTurn[] {
  const turns: ChatTurn[] = [];
  const callsById = new Map<string, { name: string; input: unknown }>();

  const currentAssistant = (id: string): Extract<ChatTurn, { role: 'assistant' }> => {
    const last = turns.at(-1);
    if (last?.role === 'assistant') return last;
    const turn: ChatTurn = {
      id,
      role: 'assistant',
      content: '',
      tools: [],
      error: null,
      meta: null,
    };
    turns.push(turn);
    return turn;
  };

  for (const { id, entry } of rows) {
    switch (entry.role) {
      case 'user':
        turns.push({ id, role: 'user', content: entry.text });
        break;
      case 'assistant': {
        const turn = currentAssistant(id);
        if (entry.text) turn.content = [turn.content, entry.text].filter(Boolean).join('\n\n');
        for (const call of entry.toolCalls) callsById.set(call.id, call);
        if (entry.error) turn.error = entry.error.message;
        if (entry.meta) turn.meta = { model: entry.meta.model, usage: entry.meta.usage };
        break;
      }
      case 'tool_results': {
        const turn = currentAssistant(id);
        for (const r of entry.results) {
          const proposal = r.proposalId ? proposals.get(r.proposalId) : undefined;
          const tool: ToolActivityView = {
            id: r.toolCallId,
            name: r.name,
            input: callsById.get(r.toolCallId)?.input ?? null,
            ok: !r.isError,
            summary: r.summary,
            ...(r.table && { table: r.table }),
            ...(proposal && { proposal }),
          };
          turn.tools.push(tool);
        }
        break;
      }
      case 'note':
        break;
    }
  }
  return turns;
}

const MAX_TITLE_CHARS = 60;

/** Deterministic title from the first question (no extra model call). */
export function titleFromQuestion(question: string): string {
  const text = question.replace(/\s+/g, ' ').trim();
  if (text.length <= MAX_TITLE_CHARS) return text;
  const cut = text.slice(0, MAX_TITLE_CHARS - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 30 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.!?-]+$/, '')}…`;
}
