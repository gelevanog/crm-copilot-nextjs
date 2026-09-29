import { z } from 'zod';
import { ACTIVITY_TYPES, DEAL_STAGES, EMAIL_TONES, type AiFeature } from './enums';
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

/* -------------------------------------------------------------------------- */
/* Write tools: the model can only *propose* a change                          */
/* -------------------------------------------------------------------------- */

const dealReference = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .describe(
    'The deal title (e.g. "Fleet telematics rollout") or, when the user only names the account, the company name (e.g. "Acme").',
  );

const proposalReason = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .optional()
  .describe('One short sentence explaining the change, shown to the user next to the diff.');

export const proposeDealStageChangeInputSchema = z
  .object({
    deal: dealReference,
    stage: z.enum(DEAL_STAGES).describe('The pipeline stage to move the deal to.'),
    reason: proposalReason,
  })
  .strict();

export const proposeDealUpdateInputSchema = z
  .object({
    deal: dealReference,
    amount: z
      .number()
      .int()
      .nonnegative()
      .max(1_000_000_000)
      .optional()
      .describe('New deal amount in whole USD ("$50k" = 50000).'),
    expectedCloseDate: z.iso
      .date()
      .nullable()
      .optional()
      .describe('New expected close date as YYYY-MM-DD, or null to clear it.'),
    ownerName: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .describe('Name or email of the workspace user who should own the deal.'),
    reason: proposalReason,
  })
  .strict()
  .refine(
    (v) => v.amount !== undefined || v.expectedCloseDate !== undefined || v.ownerName !== undefined,
    { message: 'Provide at least one of amount, expectedCloseDate or ownerName' },
  );

export const proposeActivityInputSchema = z
  .object({
    type: z
      .enum(ACTIVITY_TYPES)
      .describe(
        'NOTE for notes, TASK for to-dos, CALL / EMAIL / MEETING to log an interaction that already happened.',
      ),
    subject: z.string().trim().min(1).max(200).describe('Short subject line.'),
    body: z.string().trim().min(1).max(2000).optional().describe('Optional details.'),
    deal: dealReference.optional(),
    companyName: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .describe('Company to link the activity to when it is not about one specific deal.'),
  })
  .strict()
  .refine((v) => v.deal !== undefined || v.companyName !== undefined, {
    message: 'Link the activity to a deal or a company',
  });

export type SearchDealsInput = z.infer<typeof searchDealsInputSchema>;
export type GetCompanyInput = z.infer<typeof getCompanyInputSchema>;
export type ListActivitiesInput = z.infer<typeof listActivitiesInputSchema>;
export type GetPipelineStatsInput = z.infer<typeof getPipelineStatsInputSchema>;
export type ProposeDealStageChangeInput = z.infer<typeof proposeDealStageChangeInputSchema>;
export type ProposeDealUpdateInput = z.infer<typeof proposeDealUpdateInputSchema>;
export type ProposeActivityInput = z.infer<typeof proposeActivityInputSchema>;

export const READ_TOOL_NAMES = [
  'searchDeals',
  'getCompany',
  'listActivities',
  'getPipelineStats',
] as const;
export const WRITE_TOOL_NAMES = [
  'proposeDealStageChange',
  'proposeDealUpdate',
  'proposeActivity',
] as const;
export const TOOL_NAMES = [...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/* -------------------------------------------------------------------------- */
/* Proposed actions (pending changes the user approves or rejects)             */
/* -------------------------------------------------------------------------- */

export const PROPOSED_ACTION_KINDS = ['deal_stage_change', 'deal_update', 'activity'] as const;
export type ProposedActionKind = (typeof PROPOSED_ACTION_KINDS)[number];

/**
 * `stale`: the target record changed (or disappeared) after the proposal was
 * made, so approving it would overwrite something the model never saw.
 */
export const PROPOSED_ACTION_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'expired',
  'stale',
] as const;
export type ProposedActionStatus = (typeof PROPOSED_ACTION_STATUSES)[number];

/** One row of the before/after diff shown on the confirmation card. */
export interface ProposedActionChange {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
}

export interface ProposedActionView {
  id: string;
  kind: ProposedActionKind;
  status: ProposedActionStatus;
  /** e.g. "Move deal to Proposal" */
  title: string;
  target: { label: string; href: string | null };
  changes: ProposedActionChange[];
  reason: string | null;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  /** Outcome detail, e.g. why a proposal went stale. */
  resultMessage: string | null;
}

/* -------------------------------------------------------------------------- */
/* Copilot chat and saved conversations                                        */
/* -------------------------------------------------------------------------- */

export const chatRequestSchema = z
  .object({
    /** Continue this saved conversation; omit to start a new one. */
    conversationId: z.string().trim().min(1).max(64).optional(),
    message: z.string().trim().min(1).max(4000),
  })
  .strict();
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const renameConversationRequestSchema = z
  .object({ title: z.string().trim().min(1).max(120) })
  .strict();
export type RenameConversationRequest = z.infer<typeof renameConversationRequestSchema>;

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
  | { type: 'conversation'; id: string; title: string }
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | {
      type: 'tool_result';
      id: string;
      name: string;
      ok: boolean;
      summary: string;
      table?: ResultTable;
      proposal?: ProposedActionView;
    }
  | { type: 'done'; provider: string; model: string; usage: UsageSummary }
  | { type: 'error'; code: string; message: string };

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/** A tool call and its result, as re-rendered from a saved conversation. */
export interface ToolActivityView {
  id: string;
  name: string;
  input: unknown;
  ok: boolean;
  summary: string;
  table?: ResultTable;
  /** Current state of the proposal (read fresh, not as it was when proposed). */
  proposal?: ProposedActionView;
}

export type ChatTurn =
  | { id: string; role: 'user'; content: string }
  | {
      id: string;
      role: 'assistant';
      content: string;
      tools: ToolActivityView[];
      error: string | null;
      meta: { model: string; usage: UsageSummary } | null;
    };

export interface ConversationDetail extends ConversationSummary {
  turns: ChatTurn[];
}

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
