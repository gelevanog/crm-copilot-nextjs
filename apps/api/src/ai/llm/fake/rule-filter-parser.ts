import { describeDealFilter, OPEN_DEAL_STAGES, type DealFilter, type DealStage } from '@crm/shared';

/**
 * Deterministic "NL -> DealFilter" parser used by the fake provider.
 *
 * It understands the phrasing used in the demo and tests (stages, amount
 * ranges, "stuck for N weeks", "closing this month", "my deals", "top 5",
 * company names). A real model handles open-ended phrasing; this keeps the
 * whole app usable and testable without API keys.
 */

const STAGE_WORDS: [RegExp, DealStage][] = [
  [/\bleads?\b/, 'LEAD'],
  [/\bqualified\b/, 'QUALIFIED'],
  [/\bproposals?\b/, 'PROPOSAL'],
  [/\bnegotiat(?:ion|ing)\b/, 'NEGOTIATION'],
  [/\bwon\b/, 'WON'],
  [/\blost\b/, 'LOST'],
];

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const AMOUNT = String.raw`\$?\s*(\d+(?:[.,]\d+)?)\s*(k|m|thousand|million)?\b`;
const QTY = String.raw`(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)`;
const UNIT = String.raw`(day|week|month)s?`;

export function toAmount(value: string, suffix: string | undefined): number {
  const n = Number(value.replace(',', '.'));
  const multiplier =
    suffix === 'k' || suffix === 'thousand'
      ? 1_000
      : suffix === 'm' || suffix === 'million'
        ? 1_000_000
        : 1;
  return Math.round(n * multiplier);
}

/** First amount match that is not actually a duration ("more than 2 weeks"). */
function findAmount(text: string, pattern: string): number | undefined {
  for (const m of text.matchAll(new RegExp(pattern, 'g'))) {
    const after = text.slice((m.index ?? 0) + m[0].length);
    if (!m[2] && /^\s*(day|week|month)s?\b/.test(after)) continue;
    return toAmount(m[1]!, m[2]);
  }
  return undefined;
}

function toDays(qty: string, unit: string): number {
  const n = NUMBER_WORDS[qty] ?? Number(qty);
  return unit.startsWith('week') ? n * 7 : unit.startsWith('month') ? n * 30 : n;
}

/** Extracts a capitalised company-like name following "with/for/at/about/from". */
export function extractCompanyName(text: string): string | undefined {
  const match =
    /\b(?:with|for|at|about|from|on)\s+([A-Z][\w&.'-]*(?:\s+(?:[A-Z][\w&.'-]*|&))*)/.exec(text);
  const name = match?.[1]?.replace(/[.'?!,]+$/, '').trim();
  if (!name) return undefined;
  const words = name.split(/\s+/).filter((w) => !/^(Deals?|Account|Company|Inc|LLC)$/i.test(w));
  return words.length ? words.join(' ') : undefined;
}

export interface RuleParseResult {
  filter: DealFilter;
  explanation: string;
}

export function parseDealFilterRules(input: string): RuleParseResult {
  const text = input.toLowerCase();
  const filter: DealFilter = {};

  // Stages
  const stages = new Set<DealStage>();
  for (const [pattern, stage] of STAGE_WORDS) if (pattern.test(text)) stages.add(stage);
  if (/\bopen\b|\bactive\b/.test(text)) OPEN_DEAL_STAGES.forEach((s) => stages.add(s));
  if (/\bclosed\b/.test(text) && !/closed[- ]won|closed[- ]lost/.test(text)) {
    stages.add('WON');
    stages.add('LOST');
  }
  if (stages.size > 0) filter.stages = [...stages];

  // Amounts
  const between = new RegExp(String.raw`between\s+${AMOUNT}\s+and\s+${AMOUNT}`).exec(text);
  if (between) {
    filter.minAmount = toAmount(between[1]!, between[2]);
    filter.maxAmount = toAmount(between[3]!, between[4]);
  } else {
    const min = findAmount(
      text,
      String.raw`(?:over|above|more than|greater than|bigger than|at least|>=?|minimum)\s*${AMOUNT}`,
    );
    if (min !== undefined) filter.minAmount = min;
    const max = findAmount(
      text,
      String.raw`(?:under|below|less than|smaller than|at most|up to|<=?|maximum)\s*${AMOUNT}`,
    );
    if (max !== undefined) filter.maxAmount = max;
  }

  // Stuck / idle duration: "for more than 2 weeks", "stuck 10 days", "no movement in a month"
  const duration = new RegExp(
    String.raw`(?:for|in|over|since)?\s*(?:more than|over|at least|longer than)?\s*${QTY}\s+${UNIT}`,
  ).exec(text.replace(/closing[^,.;]*/g, ''));
  const mentionsStuck =
    /\b(stuck|stalled|idle|no movement|not moved|haven'?t moved|sitting)\b/.test(text);
  if (duration && (mentionsStuck || /\bfor\b/.test(duration[0]))) {
    filter.stuckForDays = toDays(duration[1]!, duration[2]!);
  } else if (mentionsStuck) {
    filter.stuckForDays = 14;
  }

  // Expected close window
  const closingIn = new RegExp(
    String.raw`clos(?:e|ing)\s+(?:in|within)\s+(?:the\s+next\s+)?${QTY}\s+${UNIT}`,
  ).exec(text);
  if (closingIn) filter.closingWithinDays = toDays(closingIn[1]!, closingIn[2]!);
  else if (/clos(?:e|ing)\s+this\s+week/.test(text)) filter.closingWithinDays = 7;
  else if (/clos(?:e|ing)\s+(?:this|next)\s+month|clos(?:e|ing)\s+soon/.test(text))
    filter.closingWithinDays = 30;
  else if (/clos(?:e|ing)\s+this\s+quarter/.test(text)) filter.closingWithinDays = 90;

  // Ownership
  if (/\b(my|mine|i own|assigned to me)\b/.test(text)) filter.ownedByMe = true;

  // Ranking
  const top = /\btop\s+(\d+)\b/.exec(text);
  if (top) filter.limit = Math.min(100, Number(top[1]));
  if (/\b(smallest|lowest)\b/.test(text)) {
    filter.sortBy = 'amount';
    filter.sortDir = 'asc';
  } else if (/\b(biggest|largest|highest|top)\b/.test(text)) {
    filter.sortBy = 'amount';
    filter.sortDir = 'desc';
  } else if (/\b(oldest|longest)\b/.test(text)) {
    filter.sortBy = 'stageChangedAt';
    filter.sortDir = 'asc';
  } else if (/closing (?:soonest|first)|soonest/.test(text)) {
    filter.sortBy = 'expectedCloseDate';
    filter.sortDir = 'asc';
  }

  // Company name (capitalised words after with/for/at/...)
  const company = extractCompanyName(input);
  if (company) filter.text = company;

  const chips = describeDealFilter(filter).map(
    (c) => c.label.charAt(0).toLowerCase() + c.label.slice(1),
  );
  const explanation =
    chips.length > 0
      ? `Showing deals where ${chips.join(', ')}.`
      : 'No filter criteria recognised; showing all deals.';
  return { filter, explanation };
}
