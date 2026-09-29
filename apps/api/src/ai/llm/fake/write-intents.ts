import type { WRITE_TOOL_NAMES } from '@crm/shared';
import { toAmount } from './rule-filter-parser';

/**
 * Deterministic "request a change" parser used by the fake provider. It maps
 * the demo phrasings to the same propose* tool calls a real model would make:
 *
 *   "Move the Acme deal to Proposal"            -> proposeDealStageChange
 *   "Set the amount of Brightwave to $70k"      -> proposeDealUpdate
 *   "Reassign the Acme deal to Sam"             -> proposeDealUpdate
 *   "Log a note on Acme: Dana wants a new quote" -> proposeActivity
 */

export interface PlannedWriteCall {
  name: (typeof WRITE_TOOL_NAMES)[number];
  input: Record<string, unknown>;
}

const REF = String.raw`(?:the\s+)?(.+?)(?:'s)?(?:\s+(?:deal|opportunity))?`;
const STAGE = '(lead|qualified|proposal|negotiation|won|lost)';
const AMOUNT = String.raw`\$?\s*(\d+(?:[.,]\d+)?)\s*(k|m)?`;
const DATE = String.raw`(\d{4}-\d{2}-\d{2})`;
const SET = '(?:set|change|update|move|push|increase|decrease|lower|raise|bump)';

const re = (pattern: string) => new RegExp(String.raw`\b${pattern}$`, 'i');

const STAGE_CHANGE = [
  re(
    String.raw`(?:move|advance|push|put|set|change)\s+${REF}\s+(?:back\s+)?(?:to|into)\s+(?:the\s+)?${STAGE}(?:\s+stage)?`,
  ),
  re(String.raw`mark\s+${REF}\s+as\s+${STAGE}`),
];
const AMOUNT_CHANGE = [
  re(String.raw`${SET}\s+(?:the\s+)?(?:amount|value)\s+(?:of|for|on)\s+${REF}\s+to\s+${AMOUNT}`),
  re(String.raw`${SET}\s+${REF}\s+(?:amount|value)\s+to\s+${AMOUNT}`),
];
const CLOSE_DATE_CHANGE = [
  re(String.raw`${SET}\s+(?:the\s+)?close\s+date\s+(?:of|for|on)\s+${REF}\s+to\s+${DATE}`),
  re(String.raw`${SET}\s+${REF}\s+close\s+date\s+to\s+${DATE}`),
];
const OWNER_CHANGE = re(
  String.raw`(?:assign|reassign|hand\s+over|give)\s+${REF}\s+to\s+([a-z][\w.@-]*(?:\s+[a-z][\w-]*)?)`,
);
const ACTIVITY = re(
  String.raw`(?:log|add|create|record)\s+(?:a|an)\s+(note|task|call|email|meeting)\s+(?:for|on|to|about|with)\s+(?:the\s+)?(.+?)(\s+deal)?\s*[:–—-]\s+(.+)`,
);

const MAX_SUBJECT_CHARS = 120;

export function planWriteCall(question: string): PlannedWriteCall | undefined {
  const q = question.trim().replace(/[.!?]+$/, '');

  const stage = firstMatch(STAGE_CHANGE, q);
  if (stage) {
    return {
      name: 'proposeDealStageChange',
      input: { deal: stage[1], stage: stage[2]!.toUpperCase() },
    };
  }
  const amount = firstMatch(AMOUNT_CHANGE, q);
  if (amount) {
    return {
      name: 'proposeDealUpdate',
      input: { deal: amount[1], amount: toAmount(amount[2]!, amount[3]?.toLowerCase()) },
    };
  }
  const close = firstMatch(CLOSE_DATE_CHANGE, q);
  if (close) {
    return { name: 'proposeDealUpdate', input: { deal: close[1], expectedCloseDate: close[2] } };
  }
  const owner = OWNER_CHANGE.exec(q);
  if (owner) {
    return { name: 'proposeDealUpdate', input: { deal: owner[1], ownerName: owner[2] } };
  }
  const activity = ACTIVITY.exec(q);
  if (activity) {
    const [, type, reference, isDeal, text] = activity;
    return {
      name: 'proposeActivity',
      input: {
        type: type!.toUpperCase(),
        ...splitSubject(text!),
        ...(isDeal ? { deal: reference } : { companyName: reference }),
      },
    };
  }
  return undefined;
}

function firstMatch(patterns: RegExp[], text: string): RegExpExecArray | undefined {
  for (const pattern of patterns) {
    const m = pattern.exec(text);
    if (m) return m;
  }
  return undefined;
}

function splitSubject(text: string): { subject: string; body?: string } {
  const clean = text.trim();
  const sentence = clean.charAt(0).toUpperCase() + clean.slice(1);
  if (sentence.length <= MAX_SUBJECT_CHARS) return { subject: sentence };
  const cut = sentence.slice(0, MAX_SUBJECT_CHARS - 1);
  return { subject: `${cut.slice(0, cut.lastIndexOf(' '))}…`, body: sentence };
}
