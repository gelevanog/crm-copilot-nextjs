import {
  dealFilterSchema,
  dealFilterToParams,
  parseDealFilterParams,
  parsedFilterSchema,
} from '@crm/shared';
import { describe, expect, it } from 'vitest';
import { parseDealFilterRules } from '../src/ai/llm/fake/rule-filter-parser';

describe('parseDealFilterRules (fake provider NL -> filter)', () => {
  it.each([
    [
      'Which deals over $20k are stuck in Negotiation for more than 2 weeks?',
      { stages: ['NEGOTIATION'], minAmount: 20000, stuckForDays: 14 },
    ],
    [
      'my open deals over 25k closing this month',
      {
        stages: ['LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION'],
        minAmount: 25000,
        closingWithinDays: 30,
        ownedByMe: true,
      },
    ],
    [
      'proposals between $10k and $50k',
      { stages: ['PROPOSAL'], minAmount: 10000, maxAmount: 50000 },
    ],
    [
      'top 5 biggest qualified deals',
      { stages: ['QUALIFIED'], limit: 5, sortBy: 'amount', sortDir: 'desc' },
    ],
    ['deals with Lumen Retail under 1.5m', { text: 'Lumen Retail', maxAmount: 1500000 }],
    ['stalled deals', { stuckForDays: 14 }],
  ])('%s', (text, expected) => {
    const { filter } = parseDealFilterRules(text);
    expect(filter).toEqual(expected);
    // Whatever the parser produces must pass the shared schema.
    expect(dealFilterSchema.safeParse(filter).success).toBe(true);
  });

  it('explains when nothing was recognised', () => {
    const result = parseDealFilterRules('hello there');
    expect(result.filter).toEqual({});
    expect(result.explanation).toMatch(/No filter criteria/);
  });
});

describe('shared deal filter schema', () => {
  it('rejects values a model might hallucinate', () => {
    expect(dealFilterSchema.safeParse({ stages: ['CLOSING'] }).success).toBe(false);
    expect(dealFilterSchema.safeParse({ minAmount: -5 }).success).toBe(false);
    expect(dealFilterSchema.safeParse({ minAmount: 50000, maxAmount: 1000 }).success).toBe(false);
    // Unknown keys are rejected, so a model cannot smuggle in e.g. a workspace id.
    expect(dealFilterSchema.safeParse({ workspaceId: 'other-tenant' }).success).toBe(false);
  });

  it('requires an explanation in the structured NL-filter output', () => {
    expect(parsedFilterSchema.safeParse({ filter: { minAmount: 1 } }).success).toBe(false);
    expect(
      parsedFilterSchema.safeParse({ filter: { minAmount: 1 }, explanation: 'ok' }).success,
    ).toBe(true);
  });

  it('round-trips through URL query parameters', () => {
    const filter = {
      text: 'Acme',
      stages: ['PROPOSAL', 'NEGOTIATION'] as ('PROPOSAL' | 'NEGOTIATION')[],
      minAmount: 20000,
      stuckForDays: 14,
      ownedByMe: true,
      sortBy: 'amount' as const,
      sortDir: 'asc' as const,
    };
    const params = Object.fromEntries(dealFilterToParams(filter));
    const parsed = parseDealFilterParams(params);
    expect(parsed.success && parsed.data).toEqual(filter);
  });

  it('reports invalid query parameters instead of ignoring them', () => {
    expect(parseDealFilterParams({ minAmount: 'abc' }).success).toBe(false);
    expect(parseDealFilterParams({ stages: 'negotiation' }).success).toBe(true);
  });
});
