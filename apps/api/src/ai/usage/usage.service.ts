import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AI_FEATURES, type AiFeature, type AiUsageReport } from '@crm/shared';
import { InjectEnv } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.module';
import type { TenantScope } from '../../common/tenant-scope';
import { daysAgo } from '../../common/mappers';
import type { TokenUsage } from '../llm/llm.types';
import { estimateCostUsd, priceFor } from '../llm/pricing';

export interface UsageRecord {
  scope: TenantScope;
  feature: AiFeature;
  provider: string;
  model: string;
  usage: TokenUsage;
  latencyMs: number;
  toolCalls?: number;
  success: boolean;
  errorCode?: string | null;
}

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectEnv() private readonly env: Env,
  ) {}

  costOf(model: string, usage: TokenUsage): number {
    return estimateCostUsd(model, usage, this.priceOverride());
  }

  /** Persists one usage row. Accounting failures are logged, never surfaced to the user. */
  async record(rec: UsageRecord): Promise<number> {
    const costUsd = this.costOf(rec.model, rec.usage);
    if (!priceFor(rec.model, this.priceOverride())) {
      this.logger.warn(`No price configured for model "${rec.model}"; cost recorded as 0`);
    }
    this.logger.log(
      `ai_usage feature=${rec.feature} provider=${rec.provider} model=${rec.model} ` +
        `in=${rec.usage.inputTokens} out=${rec.usage.outputTokens} cost=$${costUsd.toFixed(6)} ` +
        `latency=${rec.latencyMs}ms success=${rec.success}${rec.errorCode ? ` error=${rec.errorCode}` : ''}`,
    );
    try {
      await this.prisma.aiUsage.create({
        data: {
          workspaceId: rec.scope.workspaceId,
          userId: rec.scope.userId,
          feature: rec.feature,
          provider: rec.provider,
          model: rec.model,
          inputTokens:
            rec.usage.inputTokens + rec.usage.cacheReadTokens + rec.usage.cacheWriteTokens,
          outputTokens: rec.usage.outputTokens,
          costUsd: new Prisma.Decimal(costUsd),
          latencyMs: Math.round(rec.latencyMs),
          toolCalls: rec.toolCalls ?? 0,
          success: rec.success,
          errorCode: rec.errorCode ?? null,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to persist AI usage: ${(err as Error).message}`);
    }
    return costUsd;
  }

  async report(scope: TenantScope, periodDays = 14): Promise<AiUsageReport> {
    const since = daysAgo(periodDays);
    const where = { workspaceId: scope.workspaceId, createdAt: { gte: since } };

    const [totals, failed, byFeature, daily, recent] = await Promise.all([
      this.prisma.aiUsage.aggregate({
        where,
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true, costUsd: true },
        _avg: { latencyMs: true },
      }),
      this.prisma.aiUsage.count({ where: { ...where, success: false } }),
      this.prisma.aiUsage.groupBy({
        by: ['feature'],
        where,
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true, costUsd: true },
      }),
      this.prisma.$queryRaw<{ date: string; calls: number; cost: number }[]>`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS date,
               count(*)::int AS calls,
               coalesce(sum("costUsd"), 0)::float AS cost
        FROM "AiUsage"
        WHERE "workspaceId" = ${scope.workspaceId} AND "createdAt" >= ${since}
        GROUP BY 1 ORDER BY 1`,
      this.prisma.aiUsage.findMany({
        where,
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
    ]);

    const dailyByDate = new Map(daily.map((d) => [d.date, d]));
    const days: AiUsageReport['daily'] = [];
    for (let i = periodDays - 1; i >= 0; i--) {
      const date = daysAgo(i).toISOString().slice(0, 10);
      const row = dailyByDate.get(date);
      days.push({ date, calls: row?.calls ?? 0, costUsd: row?.cost ?? 0 });
    }

    return {
      periodDays,
      totals: {
        calls: totals._count._all,
        failedCalls: failed,
        inputTokens: totals._sum.inputTokens ?? 0,
        outputTokens: totals._sum.outputTokens ?? 0,
        costUsd: totals._sum.costUsd?.toNumber() ?? 0,
        avgLatencyMs: Math.round(totals._avg.latencyMs ?? 0),
      },
      byFeature: AI_FEATURES.map((feature) => {
        const row = byFeature.find((r) => r.feature === feature);
        return {
          feature,
          calls: row?._count._all ?? 0,
          inputTokens: row?._sum.inputTokens ?? 0,
          outputTokens: row?._sum.outputTokens ?? 0,
          costUsd: row?._sum.costUsd?.toNumber() ?? 0,
        };
      }),
      daily: days,
      recent: recent.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        feature: r.feature,
        provider: r.provider,
        model: r.model,
        userName: r.user.name,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        costUsd: r.costUsd.toNumber(),
        latencyMs: r.latencyMs,
        success: r.success,
        errorCode: r.errorCode,
      })),
      rateLimit: {
        capacity: this.env.AI_RATE_LIMIT_CAPACITY,
        refillPerMinute: this.env.AI_RATE_LIMIT_REFILL_PER_MINUTE,
      },
    };
  }

  private priceOverride() {
    return {
      inputPerMTok: this.env.LLM_PRICE_INPUT_PER_MTOK,
      outputPerMTok: this.env.LLM_PRICE_OUTPUT_PER_MTOK,
    };
  }
}
