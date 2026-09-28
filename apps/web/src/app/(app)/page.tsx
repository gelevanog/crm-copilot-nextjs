import {
  DEAL_STAGE_LABELS,
  type DealListItem,
  type Paginated,
  type PipelineStats,
} from '@crm/shared';
import {
  AlertTriangle,
  ArrowRight,
  CircleDollarSign,
  Handshake,
  Trophy,
  TrendingUp,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AskAboutButton } from '@/components/copilot/copilot-provider';
import { PageHeader } from '@/components/page-header';
import { StageBadge, STAGE_DOT } from '@/components/stage-badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { formatCompactUsd, formatUsd } from '@/lib/format';

export const metadata: Metadata = { title: 'Overview' };

export default async function OverviewPage() {
  const [stats, stuck] = await Promise.all([
    api<PipelineStats>('/pipeline/stats'),
    api<Paginated<DealListItem>>('/deals?stuckForDays=14&sortBy=amount&sortDir=desc&limit=6'),
  ]);
  const open = stats.stages.filter((s) => s.stage !== 'WON' && s.stage !== 'LOST');
  const maxAmount = Math.max(1, ...open.map((s) => s.amount));

  const kpis = [
    { label: 'Open pipeline', value: formatUsd(stats.openAmount), icon: CircleDollarSign },
    { label: 'Open deals', value: String(stats.openCount), icon: Handshake },
    { label: 'Won (90 days)', value: formatUsd(stats.wonAmountLast90Days), icon: Trophy },
    {
      label: 'Win rate (90 days)',
      value:
        stats.winRateLast90Days === null ? '—' : `${Math.round(stats.winRateLast90Days * 100)}%`,
      icon: TrendingUp,
    },
  ];

  return (
    <>
      <PageHeader
        title="Overview"
        description="Pipeline health at a glance."
        actions={
          <AskAboutButton label="Explain my pipeline" question="How is the pipeline looking?" />
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="text-muted-foreground text-xs font-medium">{label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
              </div>
              <span className="bg-muted flex size-10 items-center justify-center rounded-lg">
                <Icon className="text-muted-foreground size-5" />
              </span>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Open pipeline by stage</CardTitle>
              <CardDescription>Deal amount per stage</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {open.map((s) => (
              <Link key={s.stage} href={`/deals?stages=${s.stage}`} className="group block">
                <div className="mb-1.5 flex items-baseline justify-between text-sm">
                  <span className="flex items-center gap-2 font-medium">
                    <span className={`size-2 rounded-full ${STAGE_DOT[s.stage]}`} />
                    {DEAL_STAGE_LABELS[s.stage]}
                    <span className="text-muted-foreground text-xs font-normal">
                      {s.count} deals
                    </span>
                  </span>
                  <span className="tabular-nums">{formatCompactUsd(s.amount)}</span>
                </div>
                <div className="bg-muted h-2 overflow-hidden rounded-full">
                  <div
                    className={`h-full rounded-full ${STAGE_DOT[s.stage]} opacity-80 transition-opacity group-hover:opacity-100`}
                    style={{ width: `${(s.amount / maxAmount) * 100}%` }}
                  />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-amber-500" />
                Needs attention
              </CardTitle>
              <CardDescription>
                {stats.stuckOver14Days} open deals have not changed stage for more than 14 days
              </CardDescription>
            </div>
            <Link
              href="/deals?stuckForDays=14"
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
            >
              View all <ArrowRight className="size-3" />
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y border-t">
              {stuck.items.map((deal) => (
                <li key={deal.id}>
                  <Link
                    href={`/deals/${deal.id}`}
                    className="hover:bg-muted/50 flex items-center gap-4 px-5 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{deal.title}</p>
                      <p className="text-muted-foreground truncate text-xs">
                        {deal.company.name} · {deal.owner.name}
                      </p>
                    </div>
                    <StageBadge stage={deal.stage} />
                    <span className="w-20 text-right text-sm tabular-nums">
                      {formatCompactUsd(deal.amount)}
                    </span>
                    <span className="w-16 text-right text-xs tabular-nums text-amber-600">
                      {deal.daysInStage}d idle
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
