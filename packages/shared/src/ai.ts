import { z } from 'zod';
import { ACTIVITY_TYPES, EMAIL_TONES, type AiFeature } from './enums';
import { dealFilterSchema } from './deal-filter';

/* -------------------------------------------------------------------------- */
/* Copilot tools (inputs are produced by the LLM and validated server-side)    */
/* -------------------------------------------------------------------------- */

export const searchDealsInputSchema = dealFilterSchema;

export const getCompanyInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .describe('Company name or a distinctive part of it, e.g. "Acme".'),
  })
  .strict();

export const listActivitiesInputSchema = z
  .object({
    companyName: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .describe('Only activities linked to this company (name or part of it).'),
    types: z.array(z.enum(ACTIVITY_TYPES)).min(1).optional().describe('Only these activity types.'),
    sinceDays: z
      .number()
      .int()
      .positive()
      .max(3650)
      .optional()
      .describe('Only activities from the last N days.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe('Maximum number of activities, newest first (default 10).'),
  })
  .strict();

export const getPipelineStatsInputSchema = z
  .object({
    ownedByMe: z.boolean().optional().describe('Only count deals owned by the current user.'),
  })
  .strict();

export type SearchDealsInput = z.infer<typeof searchDealsInputSchema>;
export type GetCompanyInput = z.infer<typeof getCompanyInputSchema>;
export type ListActivitiesInput = z.infer<typeof listActivitiesInputSchema>;
export type GetPipelineStatsInput = z.infer<typeof getPipelineStatsInputSchema>;

export const TOOL_NAMES = [
  'searchDeals',
  'getCompany',
  'listActivities',
  'getPipelineStats',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/* -------------------------------------------------------------------------- */
/* Copilot chat                                                                */
/* -------------------------------------------------------------------------- */

export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(4000),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatRequestSchema = z.object({
  messages: z
    .array(chatMessageSchema)
    .min(1)
    .max(30)
    .refine((m) => m[m.length - 1]?.role === 'user', {
      message: 'The last message must come from the user',
    }),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** Compact tabular payload a tool result can carry for the chat UI. */
export interface ResultTable {
  columns: { key: string; label: string; align?: 'left' | 'right' }[];
  rows: { href?: string; cells: Record<string, string | number | null> }[];
}

export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** Newline-delimited JSON events streamed by `POST /ai/chat`. */
export type ChatStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | {
      type: 'tool_result';
      id: string;
      name: string;
      ok: boolean;
      summary: string;
      table?: ResultTable;
    }
  | { type: 'done'; provider: string; model: string; usage: UsageSummary }
  | { type: 'error'; code: string; message: string };

/* -------------------------------------------------------------------------- */
/* Smart actions (structured outputs)                                          */
/* -------------------------------------------------------------------------- */

export const followUpRequestSchema = z.object({
  tone: z.enum(EMAIL_TONES).default('friendly'),
});
export type FollowUpRequest = z.infer<typeof followUpRequestSchema>;

export const followUpEmailSchema = z
  .object({
    subject: z.string().min(1).max(160).describe('Email subject line.'),
    body: z
      .string()
      .min(1)
      .max(4000)
      .describe('Plain-text email body including greeting and sign-off.'),
    keyPoints: z
      .array(z.string().min(1).max(200))
      .max(5)
      .describe('The facts from the CRM record the email relies on.'),
  })
  .strict();
export type FollowUpEmail = z.infer<typeof followUpEmailSchema>;

export const notesSummarySchema = z
  .object({
    summary: z.string().min(1).max(1200).describe('Two to four sentence overview of the account.'),
    keyPoints: z.array(z.string().min(1).max(240)).max(6),
    sentiment: z
      .enum(['positive', 'neutral', 'at_risk'])
      .describe('Overall health of the relationship based on the notes.'),
    nextSteps: z.array(z.string().min(1).max(240)).max(5),
  })
  .strict();
export type NotesSummary = z.infer<typeof notesSummarySchema>;

/* -------------------------------------------------------------------------- */
/* Natural-language filters                                                    */
/* -------------------------------------------------------------------------- */

export const parseFilterRequestSchema = z.object({
  text: z.string().trim().min(2).max(300),
});
export type ParseFilterRequest = z.infer<typeof parseFilterRequestSchema>;

export const parsedFilterSchema = z
  .object({
    filter: dealFilterSchema,
    explanation: z
      .string()
      .min(1)
      .max(300)
      .describe('One short sentence describing how the request was interpreted.'),
  })
  .strict();
export type ParsedFilter = z.infer<typeof parsedFilterSchema>;

/* -------------------------------------------------------------------------- */
/* Usage accounting                                                            */
/* -------------------------------------------------------------------------- */

export interface AiUsageReport {
  periodDays: number;
  totals: {
    calls: number;
    failedCalls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    avgLatencyMs: number;
  };
  byFeature: {
    feature: AiFeature;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }[];
  daily: { date: string; calls: number; costUsd: number }[];
  recent: {
    id: string;
    createdAt: string;
    feature: AiFeature;
    provider: string;
    model: string;
    userName: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    latencyMs: number;
    success: boolean;
    errorCode: string | null;
  }[];
  rateLimit: { capacity: number; refillPerMinute: number };
}
