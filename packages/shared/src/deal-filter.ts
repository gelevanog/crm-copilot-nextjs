import { z } from 'zod';
import { DEAL_STAGES } from './enums';

export const DEAL_SORT_FIELDS = [
  'amount',
  'expectedCloseDate',
  'stageChangedAt',
  'updatedAt',
] as const;

/**
 * The single source of truth for "which deals?" questions.
 *
 * The same schema validates:
 *  - query strings on `GET /deals` (the regular list UI),
 *  - the `searchDeals` tool input produced by the LLM in the copilot chat,
 *  - the structured output of the natural-language filter endpoint.
 *
 * The model never writes queries; it can only fill in this object, which the
 * existing query layer then turns into a workspace-scoped Prisma query.
 */
export const dealFilterSchema = z
  .object({
    text: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .describe('Case-insensitive match on the deal title or company name.'),
    stages: z
      .array(z.enum(DEAL_STAGES))
      .min(1)
      .max(DEAL_STAGES.length)
      .optional()
      .describe('Only deals currently in one of these pipeline stages.'),
    minAmount: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Minimum deal amount in USD (inclusive). "$20k" means 20000.'),
    maxAmount: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Maximum deal amount in USD (inclusive).'),
    stuckForDays: z
      .number()
      .int()
      .positive()
      .max(3650)
      .optional()
      .describe(
        'Only deals whose stage has not changed for at least this many days ("stuck for 2 weeks" = 14).',
      ),
    closingWithinDays: z
      .number()
      .int()
      .positive()
      .max(3650)
      .optional()
      .describe('Only open deals whose expected close date is within the next N days.'),
    ownedByMe: z
      .boolean()
      .optional()
      .describe('Only deals owned by the current user ("my deals").'),
    sortBy: z.enum(DEAL_SORT_FIELDS).optional().describe('Sort field. Defaults to amount.'),
    sortDir: z.enum(['asc', 'desc']).optional().describe('Sort direction. Defaults to desc.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Maximum number of deals to return (1-100, default 50).'),
  })
  .strict()
  .refine(
    (f) => f.minAmount === undefined || f.maxAmount === undefined || f.minAmount <= f.maxAmount,
    { message: 'minAmount must be less than or equal to maxAmount', path: ['minAmount'] },
  );

export type DealFilter = z.infer<typeof dealFilterSchema>;

type SearchParamsRecord = Record<string, string | string[] | undefined>;

const NUMERIC_KEYS = [
  'minAmount',
  'maxAmount',
  'stuckForDays',
  'closingWithinDays',
  'limit',
] as const satisfies readonly (keyof DealFilter)[];

function first(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v === undefined || v.trim() === '' ? undefined : v.trim();
}

/**
 * Parses URL query parameters (Next.js `searchParams` or Express `req.query`)
 * into a validated DealFilter. Unknown parameters are ignored.
 */
export function parseDealFilterParams(params: SearchParamsRecord) {
  const raw: Record<string, unknown> = {};
  const text = first(params.text);
  if (text) raw.text = text;

  const stages = first(params.stages);
  if (stages) raw.stages = stages.split(',').map((s) => s.trim().toUpperCase());

  for (const key of NUMERIC_KEYS) {
    const value = first(params[key]);
    if (value !== undefined) raw[key] = Number(value);
  }

  const ownedByMe = first(params.ownedByMe);
  if (ownedByMe !== undefined) raw.ownedByMe = ownedByMe === 'true' || ownedByMe === '1';

  const sortBy = first(params.sortBy);
  if (sortBy) raw.sortBy = sortBy;
  const sortDir = first(params.sortDir);
  if (sortDir) raw.sortDir = sortDir;

  return dealFilterSchema.safeParse(raw);
}

/** Inverse of `parseDealFilterParams`: serialises a filter into query parameters. */
export function dealFilterToParams(filter: DealFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.text) params.set('text', filter.text);
  if (filter.stages?.length) params.set('stages', filter.stages.join(','));
  for (const key of NUMERIC_KEYS) {
    const value = filter[key];
    if (value !== undefined) params.set(key, String(value));
  }
  if (filter.ownedByMe !== undefined) params.set('ownedByMe', String(filter.ownedByMe));
  if (filter.sortBy) params.set('sortBy', filter.sortBy);
  if (filter.sortDir) params.set('sortDir', filter.sortDir);
  return params;
}

/** Human-readable chips for the active filter (used by the Deals page). */
export function describeDealFilter(filter: DealFilter): { key: keyof DealFilter; label: string }[] {
  const usd = (n: number) => `$${n.toLocaleString('en-US')}`;
  const chips: { key: keyof DealFilter; label: string }[] = [];
  if (filter.text) chips.push({ key: 'text', label: `Matches "${filter.text}"` });
  if (filter.stages?.length)
    chips.push({
      key: 'stages',
      label: `Stage: ${filter.stages.map((s) => s.charAt(0) + s.slice(1).toLowerCase()).join(', ')}`,
    });
  if (filter.minAmount !== undefined)
    chips.push({ key: 'minAmount', label: `Amount ≥ ${usd(filter.minAmount)}` });
  if (filter.maxAmount !== undefined)
    chips.push({ key: 'maxAmount', label: `Amount ≤ ${usd(filter.maxAmount)}` });
  if (filter.stuckForDays !== undefined)
    chips.push({ key: 'stuckForDays', label: `In stage ≥ ${filter.stuckForDays} days` });
  if (filter.closingWithinDays !== undefined)
    chips.push({
      key: 'closingWithinDays',
      label: `Closing within ${filter.closingWithinDays} days`,
    });
  if (filter.ownedByMe) chips.push({ key: 'ownedByMe', label: 'Owned by me' });
  if (filter.sortBy)
    chips.push({
      key: 'sortBy',
      label: `Sorted by ${filter.sortBy} (${filter.sortDir ?? 'desc'})`,
    });
  if (filter.limit !== undefined) chips.push({ key: 'limit', label: `Top ${filter.limit}` });
  return chips;
}
