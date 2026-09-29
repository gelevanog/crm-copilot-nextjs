import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, ProposedAction } from '@prisma/client';
import { z } from 'zod';
import {
  createActivityRequestSchema,
  DEAL_STAGE_LABELS,
  OPEN_DEAL_STAGES,
  updateDealRequestSchema,
  type ActivityType,
  type CreateActivityRequest,
  type DealListItem,
  type DealStage,
  type ProposeActivityInput,
  type ProposeDealStageChangeInput,
  type ProposeDealUpdateInput,
  type ProposedActionKind,
  type ProposedActionStatus,
  type ProposedActionView,
  type UpdateDealRequest,
} from '@crm/shared';
import { ActivitiesService } from '../../activities/activities.service';
import type { TenantScope } from '../../common/tenant-scope';
import { CompaniesService } from '../../companies/companies.service';
import { InjectEnv } from '../../config/config.module';
import type { Env } from '../../config/env';
import { DealsService } from '../../deals/deals.service';
import { PrismaService } from '../../prisma/prisma.module';
import { ConversationsService } from '../conversations/conversations.service';
import { proposalOutcomeNote } from '../prompts/templates';
import {
  effectiveStatus,
  proposalPreviewSchema,
  toProposalView,
  type ProposalPreview,
} from './proposal-view';

/** Where a proposal comes from: the authenticated user and their conversation. */
export interface ProposalContext {
  scope: TenantScope;
  conversationId: string;
}

/**
 * A proposal the tool refuses to create (unknown or ambiguous reference, no
 * actual change). Returned to the model as an error tool result.
 */
export class ProposalRejectedError extends Error {
  constructor(
    readonly code: 'not_found' | 'ambiguous' | 'no_change',
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ProposalRejectedError';
  }
}

/* Approval executes exactly the request body the user could have sent by hand. */
const dealPayloadSchema = z.object({ dealId: z.string().min(1), update: updateDealRequestSchema });
const activityPayloadSchema = createActivityRequestSchema;

interface ProposalDraft {
  kind: ProposedActionKind;
  payload: z.infer<typeof dealPayloadSchema> | CreateActivityRequest;
  preview: ProposalPreview;
  /** `Deal.updatedAt` the proposal was computed from, for the staleness check. */
  baseVersion: Date | null;
  reason: string | undefined;
}

const OPEN_STAGES: readonly DealStage[] = OPEN_DEAL_STAGES;
const usd = (n: number) => `$${n.toLocaleString('en-US')}`;
const day = (iso: string | null) =>
  iso
    ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : null;
const typeLabel = (t: ActivityType) => t.charAt(0) + t.slice(1).toLowerCase();
const dealTarget = (d: DealListItem) => ({
  label: `${d.title} · ${d.company.name}`,
  href: `/deals/${d.id}`,
});

/**
 * Write actions behind explicit confirmation.
 *
 * The copilot's write tools call `propose*`: input is already Zod-validated,
 * references are resolved inside the caller's workspace, and a pending
 * `ProposedAction` with a before/after diff is stored. Nothing else changes.
 *
 * `approve` is only reachable through an authenticated API call from the user
 * who received the proposal. It re-checks ownership, expiry and staleness and
 * then runs the regular service method (`DealsService.update` with an
 * optimistic-concurrency precondition, or `ActivitiesService.create`). Every
 * outcome is appended to the conversation as a note so the model knows it.
 */
@Injectable()
export class ProposedActionsService {
  private readonly ttlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly deals: DealsService,
    private readonly companies: CompaniesService,
    private readonly activities: ActivitiesService,
    private readonly conversations: ConversationsService,
    @InjectEnv() env: Env,
  ) {
    this.ttlMs = env.AI_PROPOSAL_TTL_MINUTES * 60_000;
  }

  /* ------------------------------- proposals ------------------------------ */

  async proposeStageChange(
    ctx: ProposalContext,
    input: ProposeDealStageChangeInput,
  ): Promise<ProposedActionView> {
    const deal = await this.resolveDeal(ctx.scope, input.deal, (d) => d.stage !== input.stage);
    const stage = DEAL_STAGE_LABELS[input.stage];
    if (deal.stage === input.stage) {
      throw new ProposalRejectedError('no_change', `${deal.title} is already in ${stage}.`);
    }
    return this.create(ctx, {
      kind: 'deal_stage_change',
      payload: { dealId: deal.id, update: { stage: input.stage } },
      preview: {
        title: `Move deal to ${stage}`,
        target: dealTarget(deal),
        changes: [
          { field: 'stage', label: 'Stage', before: DEAL_STAGE_LABELS[deal.stage], after: stage },
        ],
      },
      baseVersion: new Date(deal.updatedAt),
      reason: input.reason,
    });
  }

  async proposeDealUpdate(
    ctx: ProposalContext,
    input: ProposeDealUpdateInput,
  ): Promise<ProposedActionView> {
    const deal = await this.resolveDeal(ctx.scope, input.deal);
    const update: UpdateDealRequest = {};
    const changes: ProposalPreview['changes'] = [];

    if (input.amount !== undefined && input.amount !== deal.amount) {
      update.amount = input.amount;
      changes.push({
        field: 'amount',
        label: 'Amount',
        before: usd(deal.amount),
        after: usd(input.amount),
      });
    }
    const currentClose = deal.expectedCloseDate?.slice(0, 10) ?? null;
    if (input.expectedCloseDate !== undefined && input.expectedCloseDate !== currentClose) {
      update.expectedCloseDate = input.expectedCloseDate;
      changes.push({
        field: 'expectedCloseDate',
        label: 'Expected close',
        before: day(currentClose),
        after: day(input.expectedCloseDate),
      });
    }
    if (input.ownerName !== undefined) {
      const owner = await this.resolveOwner(ctx.scope, input.ownerName);
      if (owner.id !== deal.owner.id) {
        update.ownerId = owner.id;
        changes.push({
          field: 'owner',
          label: 'Owner',
          before: deal.owner.name,
          after: owner.name,
        });
      }
    }
    if (changes.length === 0) {
      throw new ProposalRejectedError('no_change', `${deal.title} already has these values.`);
    }

    return this.create(ctx, {
      kind: 'deal_update',
      payload: { dealId: deal.id, update },
      preview: {
        title:
          changes.length === 1 ? `Change deal ${changes[0]!.label.toLowerCase()}` : 'Update deal',
        target: dealTarget(deal),
        changes,
      },
      baseVersion: new Date(deal.updatedAt),
      reason: input.reason,
    });
  }

  async proposeActivity(
    ctx: ProposalContext,
    input: ProposeActivityInput,
  ): Promise<ProposedActionView> {
    const base = { type: input.type, subject: input.subject, body: input.body };
    let payload: CreateActivityRequest;
    let target: ProposalPreview['target'];

    if (input.deal !== undefined) {
      const deal = await this.resolveDeal(ctx.scope, input.deal);
      payload = { ...base, dealId: deal.id };
      target = dealTarget(deal);
    } else {
      const name = input.companyName ?? '';
      const company = await this.companies.findByName(ctx.scope, name);
      if (!company) {
        throw new ProposalRejectedError(
          'not_found',
          `No company matching "${name}" in this workspace.`,
        );
      }
      payload = { ...base, companyId: company.id };
      target = { label: company.name, href: `/companies/${company.id}` };
    }

    return this.create(ctx, {
      kind: 'activity',
      payload: activityPayloadSchema.parse(payload),
      preview: {
        title: `Log ${typeLabel(input.type).toLowerCase()}`,
        target,
        changes: [
          { field: 'type', label: 'Type', before: null, after: typeLabel(input.type) },
          { field: 'subject', label: 'Subject', before: null, after: input.subject },
          ...(input.body
            ? [{ field: 'body', label: 'Details', before: null, after: input.body }]
            : []),
        ],
      },
      // Creating an activity overwrites nothing, so there is no version to compare.
      baseVersion: null,
      reason: undefined,
    });
  }

  /* ------------------------------- decisions ------------------------------ */

  async approve(scope: TenantScope, id: string): Promise<ProposedActionView> {
    const row = await this.claim(scope, id, 'approved');
    try {
      await this.execute(scope, row);
    } catch (err) {
      if (!(
        err instanceof ConflictException ||
        err instanceof NotFoundException ||
        err instanceof BadRequestException
      )) {
        // Unexpected failure: release the claim so the user can retry.
        await this.prisma.proposedAction.update({
          where: { id: row.id },
          data: { status: 'pending', decidedAt: null },
        });
        throw err;
      }
      const reason =
        err instanceof ConflictException
          ? 'the deal was modified after it was proposed'
          : 'a linked record no longer exists';
      const view = await this.settle(scope, row, 'stale', reason);
      throw new ConflictException({
        statusCode: 409,
        code: 'proposal_stale',
        message: `Not applied: ${reason}. Ask the copilot to propose it again.`,
        proposal: view,
      });
    }
    return this.settle(scope, row, 'approved', null);
  }

  async reject(scope: TenantScope, id: string): Promise<ProposedActionView> {
    const row = await this.claim(scope, id, 'rejected');
    return this.settle(scope, row, 'rejected', null);
  }

  /* -------------------------------- helpers ------------------------------- */

  private async create(ctx: ProposalContext, draft: ProposalDraft): Promise<ProposedActionView> {
    // `conversationId` comes from the server-side chat request (already checked
    // to belong to this user); workspace and user come from the JWT.
    const row = await this.prisma.proposedAction.create({
      data: {
        workspaceId: ctx.scope.workspaceId,
        userId: ctx.scope.userId,
        conversationId: ctx.conversationId,
        kind: draft.kind,
        payload: draft.payload as Prisma.InputJsonObject,
        preview: proposalPreviewSchema.parse(draft.preview),
        baseVersion: draft.baseVersion,
        reason: draft.reason ?? null,
        expiresAt: new Date(Date.now() + this.ttlMs),
      },
    });
    return toProposalView(row);
  }

  /**
   * Atomically moves a pending, unexpired proposal of this user to `status`.
   * Only one caller can win, so a proposal is executed at most once.
   */
  private async claim(
    scope: TenantScope,
    id: string,
    status: 'approved' | 'rejected',
  ): Promise<ProposedAction> {
    const row = await this.prisma.proposedAction.findFirst({
      where: { id, workspaceId: scope.workspaceId, userId: scope.userId },
    });
    if (!row) throw new NotFoundException('Proposal not found');

    const now = new Date();
    const { count } = await this.prisma.proposedAction.updateMany({
      where: { id: row.id, status: 'pending', expiresAt: { gt: now } },
      data: { status, decidedAt: now },
    });
    if (count === 1) return row;

    const current = await this.prisma.proposedAction.findUniqueOrThrow({ where: { id: row.id } });
    if (effectiveStatus(current, now) === 'expired') {
      const view =
        current.status === 'pending'
          ? await this.settle(scope, current, 'expired', null)
          : toProposalView(current, now);
      throw this.conflict(
        'proposal_expired',
        'This proposal has expired. Ask the copilot to propose it again.',
        view,
      );
    }
    const view = toProposalView(current, now);
    throw this.conflict('proposal_not_pending', `This proposal was already ${view.status}.`, view);
  }

  private async execute(scope: TenantScope, row: ProposedAction): Promise<void> {
    switch (row.kind) {
      case 'deal_stage_change':
      case 'deal_update': {
        const payload = dealPayloadSchema.parse(row.payload);
        await this.deals.update(scope, payload.dealId, payload.update, {
          ...(row.baseVersion && { ifUnmodifiedSince: row.baseVersion }),
        });
        return;
      }
      case 'activity':
        await this.activities.create(scope, activityPayloadSchema.parse(row.payload));
        return;
    }
  }

  /** Records the final status and tells the model about it through a conversation note. */
  private async settle(
    scope: TenantScope,
    row: ProposedAction,
    status: Exclude<ProposedActionStatus, 'pending'>,
    resultMessage: string | null,
  ): Promise<ProposedActionView> {
    const updated = await this.prisma.proposedAction.update({
      where: { id: row.id },
      data: { status, resultMessage, decidedAt: row.decidedAt ?? new Date() },
    });
    const view = toProposalView(updated);
    await this.conversations.append(scope, row.conversationId, [
      {
        role: 'note',
        text: proposalOutcomeNote({
          title: view.title,
          target: view.target.label,
          status,
          detail: resultMessage,
        }),
      },
    ]);
    return view;
  }

  private conflict(code: string, message: string, proposal: ProposedActionView): HttpException {
    return new ConflictException({ statusCode: 409, code, message, proposal });
  }

  /**
   * Resolves a model-supplied deal reference inside the caller's workspace.
   * An exact title wins; otherwise open deals that `isCandidate` accepts, then
   * the caller's own deals, narrow it down. Anything still ambiguous goes back
   * to the model with the candidates, so it can ask the user.
   */
  private async resolveDeal(
    scope: TenantScope,
    reference: string,
    isCandidate: (d: DealListItem) => boolean = () => true,
  ): Promise<DealListItem> {
    const { items } = await this.deals.search(scope, { text: reference, limit: 20 });
    if (items.length === 0) {
      throw new ProposalRejectedError(
        'not_found',
        `No deal matching "${reference}" in this workspace.`,
      );
    }
    const exact = items.filter((d) => d.title.toLowerCase() === reference.trim().toLowerCase());
    if (exact.length === 1) return exact[0]!;
    if (items.length === 1) return items[0]!;

    const open = items.filter((d) => OPEN_STAGES.includes(d.stage) && isCandidate(d));
    if (open.length === 1) return open[0]!;
    const mine = open.filter((d) => d.owner.id === scope.userId);
    if (mine.length === 1) return mine[0]!;

    throw new ProposalRejectedError(
      'ambiguous',
      `"${reference}" matches several deals. Ask the user which one they mean.`,
      {
        candidates: items.slice(0, 8).map((d) => ({
          title: d.title,
          company: d.company.name,
          stage: d.stage,
          owner: d.owner.name,
        })),
      },
    );
  }

  private async resolveOwner(
    scope: TenantScope,
    reference: string,
  ): Promise<{ id: string; name: string }> {
    const query = reference.trim();
    const users = await this.prisma.user.findMany({
      where: {
        workspaceId: scope.workspaceId,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { email: { equals: query, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const exact = users.filter((u) => u.name.toLowerCase() === query.toLowerCase());
    const match = exact.length === 1 ? exact[0] : users.length === 1 ? users[0] : undefined;
    if (match) return match;
    if (users.length === 0) {
      throw new ProposalRejectedError(
        'not_found',
        `No user matching "${query}" in this workspace.`,
      );
    }
    throw new ProposalRejectedError(
      'ambiguous',
      `"${query}" matches several users. Ask the user which one they mean.`,
      { candidates: users.map((u) => u.name) },
    );
  }
}
