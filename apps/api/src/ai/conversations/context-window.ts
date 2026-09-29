import { HISTORY_TRIMMED_NOTE } from '../prompts/templates';
import type { TranscriptEntry } from './transcript';

/** ~4 characters per token: a deliberately simple, provider-independent estimate. */
const CHARS_PER_TOKEN = 4;
/** Per-message overhead (role markers, block wrappers). */
const MESSAGE_OVERHEAD_TOKENS = 4;

export function estimateTokens(entry: TranscriptEntry): number {
  let chars: number;
  switch (entry.role) {
    case 'user':
    case 'note':
      chars = entry.text.length;
      break;
    case 'assistant':
      chars = entry.text.length + JSON.stringify(entry.toolCalls).length;
      break;
    case 'tool_results':
      chars = entry.results.reduce((n, r) => n + r.content.length + r.name.length, 0);
      break;
  }
  return Math.ceil(chars / CHARS_PER_TOKEN) + MESSAGE_OVERHEAD_TOKENS;
}

export interface FittedHistory {
  entries: TranscriptEntry[];
  trimmed: boolean;
}

/**
 * Keeps the most recent whole exchanges that fit in `maxTokens`.
 *
 * An exchange starts at a user message and runs until the next one, so a tool
 * call is never separated from its result and the history never starts with
 * an orphaned assistant or tool message. The newest exchange (the question
 * being answered) is always kept. When anything is dropped, a note tells the
 * model that earlier context is missing.
 */
export function fitToContextWindow(
  entries: TranscriptEntry[],
  maxTokens: number,
  opts: { olderOmitted?: boolean } = {},
): FittedHistory {
  const exchanges: TranscriptEntry[][] = [];
  for (const entry of entries) {
    if (entry.role === 'user') exchanges.push([entry]);
    // Entries before the first user message cannot start a valid history.
    else exchanges.at(-1)?.push(entry);
  }

  const kept: TranscriptEntry[][] = [];
  let budget = maxTokens;
  for (let i = exchanges.length - 1; i >= 0; i--) {
    const exchange = exchanges[i]!;
    const cost = exchange.reduce((n, e) => n + estimateTokens(e), 0);
    if (kept.length > 0 && cost > budget) break;
    kept.unshift(exchange);
    budget -= cost;
  }

  const fitted = kept.flat();
  const trimmed = opts.olderOmitted === true || fitted.length < entries.length;
  return {
    entries: trimmed ? [{ role: 'note', text: HISTORY_TRIMMED_NOTE }, ...fitted] : fitted,
    trimmed,
  };
}
