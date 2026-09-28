import { AI_FEATURE_LABELS, type AiUsageReport } from '@crm/shared';
import { Activity, CircleDollarSign, Gauge, Timer } from 'lucide-react';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TD, TH, THead, TRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatNumber, formatShortDate, formatUsdPrecise } from '@/lib/format';

export const metadata: Metadata = { title: 'AI usage' };

export default async function AiUsagePage() {
  const report = await api<AiUsageReport>('/ai/usage?days=14');
  const { totals } = report;
  const maxCalls = Math.max(1, ...report.daily.map((d) => d.calls));
  const errorRate = totals.calls === 0 ? 0 : totals.failedCalls / totals.calls;

  const kpis = [
    {
      label: 'AI requests',
      value: formatNumber(totals.calls),
      hint: `${totals.failedCalls} failed`,
      icon: Activity,
    },
    {
      label: 'Tokens',
      value: formatNumber(totals.inputTokens + totals.outputTokens),
      hint: `${formatNumber(totals.inputTokens)} in / ${formatNumber(totals.outputTokens)} out`,
      icon: Gauge,
    },
    {
      label: 'Estimated cost',
      value: formatUsdPrecise(totals.costUsd),
      hint: 'from per-model price table',
      icon: CircleDollarSign,
    },
    {
      label: 'Avg latency',
      value: `${formatNumber(totals.avgLatencyMs)} ms`,
      hint: `${(errorRate * 100).toFixed(1)}% error rate`,
      icon: Timer,
    },
  ];

  return (
    <>
      <PageHeader
        title="AI usage"
        description={`Every LLM-backed request in this workspace over the last ${report.periodDays} days.`}
        actions={
          <Badge tone="ai">
            Rate limit: {report.rateLimit.capacity} burst, {report.rateLimit.refillPerMinute}/min
            per workspace
          </Badge>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map(({ label, value, hint, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-xs font-medium">{label}</p>
                <Icon className="text-muted-foreground size-4" />
              </div>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
              <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <div>
              <CardTitle>Requests per day</CardTitle>
              <CardDescription>Hover a bar for calls and cost</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div
              className="flex h-40 items-end gap-1.5"
              role="img"
              aria-label="AI requests per day"
            >
              {report.daily.map((d) => (
                <div
                  key={d.date}
                  className="group flex h-full flex-1 flex-col justify-end"
                  title={`${d.date}: ${d.calls} calls, ${formatUsdPrecise(d.costUsd)}`}
                >
                  <div
                    className="bg-ai/80 group-hover:bg-ai min-h-[2px] rounded-t-sm transition-colors"
                    style={{ height: `${(d.calls / maxCalls) * 100}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="text-muted-foreground mt-2 flex justify-between text-[11px]">
              <span>{formatShortDate(report.daily[0]!.date)}</span>
              <span>{formatShortDate(report.daily.at(-1)!.date)}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden lg:col-span-2">
          <CardHeader>
            <CardTitle>By feature</CardTitle>
          </CardHeader>
          <Table>
            <THead>
              <tr>
                <TH>Feature</TH>
                <TH className="text-right">Calls</TH>
                <TH className="text-right">Tokens</TH>
                <TH className="text-right">Cost</TH>
              </tr>
            </THead>
            <tbody>
              {report.byFeature.map((f) => (
                <TRow key={f.feature}>
                  <TD>{AI_FEATURE_LABELS[f.feature]}</TD>
                  <TD className="text-right tabular-nums">{f.calls}</TD>
                  <TD className="text-right tabular-nums">
                    {formatNumber(f.inputTokens + f.outputTokens)}
                  </TD>
                  <TD className="text-right tabular-nums">{formatUsdPrecise(f.costUsd)}</TD>
                </TRow>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>

      <Card className="mt-6 overflow-hidden">
        <CardHeader>
          <CardTitle>Recent requests</CardTitle>
        </CardHeader>
        {report.recent.length === 0 ? (
          <CardContent className="text-muted-foreground text-sm">
            No AI requests yet. Open the copilot or try a smart action.
          </CardContent>
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Time</TH>
                <TH>Feature</TH>
                <TH>User</TH>
                <TH>Model</TH>
                <TH className="text-right">In</TH>
                <TH className="text-right">Out</TH>
                <TH className="text-right">Cost</TH>
                <TH className="text-right">Latency</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <tbody>
              {report.recent.map((r) => (
                <TRow key={r.id}>
                  <TD className="text-muted-foreground whitespace-nowrap">
                    {new Date(r.createdAt).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </TD>
                  <TD className="whitespace-nowrap">{AI_FEATURE_LABELS[r.feature]}</TD>
                  <TD className="text-muted-foreground whitespace-nowrap">{r.userName}</TD>
                  <TD>
                    <code className="text-xs">
                      {r.provider}/{r.model}
                    </code>
                  </TD>
                  <TD className="text-right tabular-nums">{formatNumber(r.inputTokens)}</TD>
                  <TD className="text-right tabular-nums">{formatNumber(r.outputTokens)}</TD>
                  <TD className="text-right tabular-nums">{formatUsdPrecise(r.costUsd)}</TD>
                  <TD className="text-right tabular-nums">{formatNumber(r.latencyMs)} ms</TD>
                  <TD>
                    {r.success ? (
                      <Badge tone="emerald">ok</Badge>
                    ) : (
                      <Badge tone="rose">{r.errorCode ?? 'error'}</Badge>
                    )}
                  </TD>
                </TRow>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
