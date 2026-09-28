import { Injectable, Logger } from '@nestjs/common';
import type { z } from 'zod';
import {
  DEAL_STAGE_LABELS,
  getCompanyInputSchema,
  getPipelineStatsInputSchema,
  listActivitiesInputSchema,
  searchDealsInputSchema,
  type DealStage,
  type ResultTable,
  type ToolName,
} from '@crm/shared';
import type { TenantScope } from '../../common/tenant-scope';
import { ActivitiesService } from '../../activities/activities.service';
import { CompaniesService } from '../../companies/companies.service';
import { DealsService } from '../../deals/deals.service';
import { toJsonSchema } from '../llm/json-schema';
import type { ToolSpec } from '../llm/llm.types';
import { TOOL_DESCRIPTIONS } from '../prompts/templates';

/* Data shapes returned to the model (compact, no internal IDs except links). */

export interface DealRow {
  title: string;
  company: string;
  stage: DealStage;
  amount: number;
  daysInStage: number;
  expectedCloseDate: string | null;
  owner: string;
}

export interface SearchDealsData {
  total: number;
  returned: number;
  totalAmount: number;
  deals: DealRow[];
}

export interface ActivityRow {
  date: string;
  type: string;
  subject: string;
  body: string | null;
  company: string | null;
  deal: string | null;
  author: string;
}

export interface GetCompanyData {
  name: string;
  industry: string | null;
  employees: number | null;
  location: string | null;
  openDeals: number;
  openPipeline: number;
  lastActivityAt: string | null;
  contacts: { name: string; title: string | null; email: string }[];
  deals: DealRow[];
  recentActivities: ActivityRow[];
}

export interface ListActivitiesData {
  count: number;
  activities: ActivityRow[];
}

export interface ToolOutcome {
  ok: boolean;
  /** JSON-serialisable payload for the model. */
  data: unknown;
  /** One-line human summary shown in the UI chip. */
  summary: string;
  table?: ResultTable;
}

export interface ToolContext {
  /** Derived from the authenticated request, never from model output. */
  scope: TenantScope;
}

interface CrmTool {
  name: ToolName;
  description: string;
  schema: z.ZodType;
  run(ctx: ToolContext, rawInput: unknown): Promise<ToolOutcome>;
}

/** Wraps a typed handler with Zod validation of the model-produced input. */
function defineTool<S extends z.ZodType>(def: {
  name: ToolName;
  schema: S;
  execute: (ctx: ToolContext, input: z.infer<S>) => Promise<ToolOutcome>;
}): CrmTool {
  return {
    name: def.name,
    description: TOOL_DESCRIPTIONS[def.name],
    schema: def.schema,
    async run(ctx, rawInput) {
      const parsed = def.schema.safeParse(rawInput);
      if (!parsed.success) {
        const issues = parsed.error.issues.map(
          (i) => `${i.path.join('.') || 'input'}: ${i.message}`,
        );
        return {
          ok: false,
          data: { error: 'invalid_arguments', issues },
          summary: `Invalid arguments: ${issues.join('; ')}`,
        };
      }
      return def.execute(ctx, parsed.data);
    },
  };
}

const MAX_BODY_CHARS = 400;
const usd = (n: number) => `$${n.toLocaleString('en-US')}`;
const isoDate = (iso: string | null) => (iso ? iso.slice(0, 10) : null);
const truncate = (s: string | null, max: number) =>
  s && s.length > max ? `${s.slice(0, max - 1)}…` : s;

@Injectable()
export class CrmToolsService {
  private readonly logger = new Logger(CrmToolsService.name);
  private readonly tools: CrmTool[];

  constructor(
    private readonly deals: DealsService,
    private readonly companies: CompaniesService,
    private readonly activities: ActivitiesService,
  ) {
    this.tools = [
      defineTool({
        name: 'searchDeals',
        schema: searchDealsInputSchema,
        execute: (ctx, input) => this.searchDeals(ctx, input),
      }),
      defineTool({
        name: 'getCompany',
        schema: getCompanyInputSchema,
        execute: (ctx, input) => this.getCompany(ctx, input.name),
      }),
      defineTool({
        name: 'listActivities',
        schema: listActivitiesInputSchema,
        execute: (ctx, input) => this.listActivities(ctx, input),
      }),
      defineTool({
        name: 'getPipelineStats',
        schema: getPipelineStatsInputSchema,
        execute: (ctx, input) => this.getPipelineStats(ctx, input.ownedByMe ?? false),
      }),
    ];
  }

  /** Tool definitions advertised to the model (JSON Schema generated from Zod). */
  specs(): ToolSpec[] {
    return this.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: toJsonSchema(t.schema),
    }));
  }

  async execute(ctx: ToolContext, name: string, rawInput: unknown): Promise<ToolOutcome> {
    const tool = this.tools.find((t) => t.name === name);
    if (!tool) {
      return {
        ok: false,
        data: { error: 'unknown_tool', name },
        summary: `Unknown tool "${name}"`,
      };
    }
    try {
      return await tool.run(ctx, rawInput);
    } catch (err) {
      this.logger.error({ err, tool: name }, 'tool execution failed');
      return {
        ok: false,
        data: { error: 'tool_failed', message: 'The lookup failed. Try again or rephrase.' },
        summary: 'Lookup failed',
      };
    }
  }

  private async searchDeals(
    ctx: ToolContext,
    input: z.infer<typeof searchDealsInputSchema>,
  ): Promise<ToolOutcome> {
    const result = await this.deals.search(ctx.scope, { limit: 25, ...input });
    const rows: DealRow[] = result.items.map((d) => ({
      title: d.title,
      company: d.company.name,
      stage: d.stage,
      amount: d.amount,
      daysInStage: d.daysInStage,
      expectedCloseDate: isoDate(d.expectedCloseDate),
      owner: d.owner.name,
    }));
    const data: SearchDealsData = {
      total: result.total,
      returned: rows.length,
      totalAmount: rows.reduce((n, r) => n + r.amount, 0),
      deals: rows,
    };
    return {
      ok: true,
      data,
      summary: `${result.total} deal${result.total === 1 ? '' : 's'} found`,
      table: {
        columns: [
          { key: 'deal', label: 'Deal' },
          { key: 'company', label: 'Company' },
          { key: 'stage', label: 'Stage' },
          { key: 'amount', label: 'Amount', align: 'right' },
          { key: 'days', label: 'Days in stage', align: 'right' },
        ],
        rows: result.items.map((d) => ({
          href: `/deals/${d.id}`,
          cells: {
            deal: d.title,
            company: d.company.name,
            stage: DEAL_STAGE_LABELS[d.stage],
            amount: usd(d.amount),
            days: d.daysInStage,
          },
        })),
      },
    };
  }

  private async getCompany(ctx: ToolContext, name: string): Promise<ToolOutcome> {
    const company = await this.companies.findByName(ctx.scope, name);
    if (!company) {
      return {
        ok: false,
        data: { error: 'not_found', message: `No company matching "${name}" in this workspace.` },
        summary: `No company matching "${name}"`,
      };
    }
    const data: GetCompanyData = {
      name: company.name,
      industry: company.industry,
      employees: company.employees,
      location: [company.city, company.country].filter(Boolean).join(', ') || null,
      openDeals: company.openDeals,
      openPipeline: company.openPipeline,
      lastActivityAt: isoDate(company.lastActivityAt),
      contacts: company.contacts.map((c) => ({
        name: `${c.firstName} ${c.lastName}`,
        title: c.title,
        email: c.email,
      })),
      deals: company.deals.map((d) => ({
        title: d.title,
        company: company.name,
        stage: d.stage,
        amount: d.amount,
        daysInStage: d.daysInStage,
        expectedCloseDate: isoDate(d.expectedCloseDate),
        owner: d.owner.name,
      })),
      recentActivities: company.activities.slice(0, 5).map((a) => ({
        date: a.occurredAt.slice(0, 10),
        type: a.type,
        subject: a.subject,
        body: truncate(a.body, MAX_BODY_CHARS),
        company: company.name,
        deal: a.deal?.title ?? null,
        author: a.author.name,
      })),
    };
    return {
      ok: true,
      data,
      summary: `${company.name}: ${company.openDeals} open deal${company.openDeals === 1 ? '' : 's'}, ${usd(company.openPipeline)} pipeline`,
      table: {
        columns: [
          { key: 'deal', label: 'Deal' },
          { key: 'stage', label: 'Stage' },
          { key: 'amount', label: 'Amount', align: 'right' },
        ],
        rows: company.deals.map((d) => ({
          href: `/deals/${d.id}`,
          cells: { deal: d.title, stage: DEAL_STAGE_LABELS[d.stage], amount: usd(d.amount) },
        })),
      },
    };
  }

  private async listActivities(
    ctx: ToolContext,
    input: z.infer<typeof listActivitiesInputSchema>,
  ): Promise<ToolOutcome> {
    const activities = await this.activities.list(ctx.scope, {
      companyName: input.companyName,
      types: input.types,
      sinceDays: input.sinceDays,
      limit: input.limit ?? 10,
    });
    const data: ListActivitiesData = {
      count: activities.length,
      activities: activities.map((a) => ({
        date: a.occurredAt.slice(0, 10),
        type: a.type,
        subject: a.subject,
        body: truncate(a.body, MAX_BODY_CHARS),
        company: a.company?.name ?? null,
        deal: a.deal?.title ?? null,
        author: a.author.name,
      })),
    };
    return {
      ok: true,
      data,
      summary: `${activities.length} activit${activities.length === 1 ? 'y' : 'ies'}`,
      table: {
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'type', label: 'Type' },
          { key: 'subject', label: 'Subject' },
          { key: 'company', label: 'Company' },
        ],
        rows: activities.map((a) => ({
          ...(a.deal && { href: `/deals/${a.deal.id}` }),
          cells: {
            date: a.occurredAt.slice(0, 10),
            type: a.type.charAt(0) + a.type.slice(1).toLowerCase(),
            subject: a.subject,
            company: a.company?.name ?? null,
          },
        })),
      },
    };
  }

  private async getPipelineStats(ctx: ToolContext, ownedByMe: boolean): Promise<ToolOutcome> {
    const stats = await this.deals.pipelineStats(ctx.scope, { ownedByMe });
    return {
      ok: true,
      data: stats,
      summary: `${stats.openCount} open deals, ${usd(stats.openAmount)}`,
      table: {
        columns: [
          { key: 'stage', label: 'Stage' },
          { key: 'count', label: 'Deals', align: 'right' },
          { key: 'amount', label: 'Amount', align: 'right' },
        ],
        rows: stats.stages.map((s) => ({
          cells: { stage: DEAL_STAGE_LABELS[s.stage], count: s.count, amount: usd(s.amount) },
        })),
      },
    };
  }
}
