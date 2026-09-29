import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  DEAL_STAGES,
  OPEN_DEAL_STAGES,
  type DealDetail,
  type DealFilter,
  type DealListItem,
  type DealStage,
  type Paginated,
  type PipelineStats,
  type UpdateDealRequest,
} from '@crm/shared';
import { PrismaService } from '../prisma/prisma.module';
import type { TenantScope } from '../common/tenant-scope';
import {
  activityInclude,
  contactInclude,
  daysAgo,
  daysFromNow,
  dealListInclude,
  toActivity,
  toContact,
  toDealListItem,
} from '../common/mappers';

const DEFAULT_LIMIT = 50;

export interface DealUpdateOptions {
  /**
   * Optimistic concurrency: apply the update only if the deal has not been
   * modified since this instant (its `updatedAt`), otherwise 409.
   */
  ifUnmodifiedSince?: Date;
}

/**
 * Translates a validated DealFilter into a workspace-scoped Prisma where
 * clause. This is the "existing query layer" that both the list UI and the AI
 * features go through.
 */
export function buildDealWhere(
  scope: TenantScope,
  filter: DealFilter,
  now: Date = new Date(),
): Prisma.DealWhereInput {
  const and: Prisma.DealWhereInput[] = [];

  if (filter.text) {
    and.push({
      OR: [
        { title: { contains: filter.text, mode: 'insensitive' } },
        { company: { name: { contains: filter.text, mode: 'insensitive' } } },
      ],
    });
  }
  if (filter.stages) and.push({ stage: { in: filter.stages } });
  if (filter.minAmount !== undefined) and.push({ amount: { gte: filter.minAmount } });
  if (filter.maxAmount !== undefined) and.push({ amount: { lte: filter.maxAmount } });
  if (filter.stuckForDays !== undefined) {
    // "Stuck" only makes sense for deals that are still open.
    and.push({ stageChangedAt: { lte: daysAgo(filter.stuckForDays, now) } });
    and.push({ stage: { in: [...OPEN_DEAL_STAGES] } });
  }
  if (filter.closingWithinDays !== undefined) {
    and.push({
      expectedCloseDate: { gte: daysAgo(1, now), lte: daysFromNow(filter.closingWithinDays, now) },
    });
    and.push({ stage: { in: [...OPEN_DEAL_STAGES] } });
  }
  if (filter.ownedByMe) and.push({ ownerId: scope.userId });

  // Tenant scope is applied last and unconditionally.
  return { AND: and, workspaceId: scope.workspaceId };
}

@Injectable()
export class DealsService {
  constructor(private readonly prisma: PrismaService) {}

  async search(scope: TenantScope, filter: DealFilter): Promise<Paginated<DealListItem>> {
    const now = new Date();
    const where = buildDealWhere(scope, filter, now);
    const orderBy: Prisma.DealOrderByWithRelationInput = {
      [filter.sortBy ?? 'amount']: filter.sortDir ?? 'desc',
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.deal.findMany({
        where,
        include: dealListInclude,
        orderBy: [orderBy, { id: 'asc' }],
        take: filter.limit ?? DEFAULT_LIMIT,
      }),
      this.prisma.deal.count({ where }),
    ]);
    return { items: rows.map((d) => toDealListItem(d, now)), total };
  }

  async findOne(scope: TenantScope, id: string): Promise<DealDetail> {
    const deal = await this.prisma.deal.findFirst({
      where: { id, workspaceId: scope.workspaceId },
      include: {
        ...dealListInclude,
        contact: { include: contactInclude },
        activities: { include: activityInclude, orderBy: { occurredAt: 'desc' }, take: 50 },
      },
    });
    if (!deal) throw new NotFoundException('Deal not found');
    return {
      ...toDealListItem(deal),
      createdAt: deal.createdAt.toISOString(),
      contact: deal.contact ? toContact(deal.contact) : null,
      activities: deal.activities.map(toActivity),
    };
  }

  async update(
    scope: TenantScope,
    id: string,
    body: UpdateDealRequest,
    opts: DealUpdateOptions = {},
  ): Promise<DealDetail> {
    const existing = await this.prisma.deal.findFirst({
      where: { id, workspaceId: scope.workspaceId },
      select: { id: true, stage: true },
    });
    if (!existing) throw new NotFoundException('Deal not found');

    if (body.ownerId !== undefined) {
      const owner = await this.prisma.user.findFirst({
        where: { id: body.ownerId, workspaceId: scope.workspaceId },
        select: { id: true },
      });
      if (!owner) throw new BadRequestException('Unknown owner');
    }

    const stageChanged = body.stage !== undefined && body.stage !== existing.stage;
    // A conditional updateMany is an atomic compare-and-swap on `updatedAt`.
    const { count } = await this.prisma.deal.updateMany({
      where: {
        id: existing.id,
        workspaceId: scope.workspaceId,
        ...(opts.ifUnmodifiedSince && { updatedAt: opts.ifUnmodifiedSince }),
      },
      data: {
        ...(body.amount !== undefined && { amount: body.amount }),
        ...(body.expectedCloseDate !== undefined && {
          expectedCloseDate: body.expectedCloseDate ? new Date(body.expectedCloseDate) : null,
        }),
        ...(body.ownerId !== undefined && { ownerId: body.ownerId }),
        ...(stageChanged && { stage: body.stage, stageChangedAt: new Date() }),
      },
    });
    if (count === 0) throw new ConflictException('The deal was modified in the meantime');
    return this.findOne(scope, id);
  }

  async pipelineStats(
    scope: TenantScope,
    opts: { ownedByMe?: boolean } = {},
  ): Promise<PipelineStats> {
    const base: Prisma.DealWhereInput = {
      workspaceId: scope.workspaceId,
      ...(opts.ownedByMe && { ownerId: scope.userId }),
    };
    const ninetyDaysAgo = daysAgo(90);
    const [byStage, closedRecently, stuck] = await Promise.all([
      this.prisma.deal.groupBy({
        by: ['stage'],
        where: base,
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.deal.groupBy({
        by: ['stage'],
        where: { ...base, stage: { in: ['WON', 'LOST'] }, stageChangedAt: { gte: ninetyDaysAgo } },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.deal.count({
        where: {
          ...base,
          stage: { in: [...OPEN_DEAL_STAGES] },
          stageChangedAt: { lte: daysAgo(14) },
        },
      }),
    ]);

    const stages = DEAL_STAGES.map((stage: DealStage) => {
      const row = byStage.find((r) => r.stage === stage);
      return { stage, count: row?._count._all ?? 0, amount: row?._sum.amount ?? 0 };
    });
    const open = stages.filter((s) => (OPEN_DEAL_STAGES as readonly DealStage[]).includes(s.stage));
    const won = closedRecently.find((r) => r.stage === 'WON');
    const lost = closedRecently.find((r) => r.stage === 'LOST');
    const closedCount = (won?._count._all ?? 0) + (lost?._count._all ?? 0);

    return {
      stages,
      openCount: open.reduce((n, s) => n + s.count, 0),
      openAmount: open.reduce((n, s) => n + s.amount, 0),
      wonAmountLast90Days: won?._sum.amount ?? 0,
      winRateLast90Days: closedCount === 0 ? null : (won?._count._all ?? 0) / closedCount,
      stuckOver14Days: stuck,
    };
  }
}
