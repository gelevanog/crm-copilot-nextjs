import {
  DEAL_STAGES,
  DEAL_STAGE_LABELS,
  dealFilterToParams,
  describeDealFilter,
  parseDealFilterParams,
  type DealFilter,
  type DealListItem,
  type Paginated,
} from '@crm/shared';
import { Columns3, List, Sparkles, X } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DealsBoard } from '@/components/deals/deals-board';
import { DealsTable } from '@/components/deals/deals-table';
import { NlFilterBar } from '@/components/deals/nl-filter-bar';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api';
import { formatUsd } from '@/lib/format';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Deals' };

type SearchParams = Record<string, string | string[] | undefined>;

function href(filter: DealFilter, extra: Record<string, string | undefined> = {}): string {
  const params = dealFilterToParams(filter);
  for (const [k, v] of Object.entries(extra)) if (v) params.set(k, v);
  const qs = params.toString();
  return qs ? `/deals?${qs}` : '/deals';
}

export default async function DealsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const view = params.view === 'board' ? 'board' : 'table';
  const nl = typeof params.nl === 'string' ? params.nl : undefined;
  const why = typeof params.why === 'string' ? params.why : undefined;

  // The same shared schema the API uses; invalid params fall back to "no filter".
  const parsed = parseDealFilterParams(params);
  const filter: DealFilter = parsed.success ? parsed.data : {};
  const result = await api<Paginated<DealListItem>>(
    `/deals?${dealFilterToParams({ limit: 100, ...filter }).toString()}`,
  );
  const chips = describeDealFilter(filter);
  const total = result.items.reduce((n, d) => n + d.amount, 0);
  const viewParam = view === 'board' ? 'board' : undefined;

  return (
    <>
      <PageHeader
        title="Deals"
        description={`${result.total} deal${result.total === 1 ? '' : 's'} · ${formatUsd(total)}`}
        actions={
          <div className="bg-muted flex rounded-lg p-0.5">
            {(['table', 'board'] as const).map((v) => (
              <Link
                key={v}
                href={href(filter, { view: v === 'board' ? 'board' : undefined, nl, why })}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium',
                  view === v ? 'bg-card shadow-xs' : 'text-muted-foreground',
                )}
              >
                {v === 'table' ? <List className="size-3.5" /> : <Columns3 className="size-3.5" />}
                {v === 'table' ? 'Table' : 'Board'}
              </Link>
            ))}
          </div>
        }
      />

      <div className="space-y-4">
        <NlFilterBar key={nl ?? ''} initialText={nl} />

        {!parsed.success && (
          <p className="text-danger text-sm">The filter in the URL is invalid and was ignored.</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            <StageTab
              label="All"
              active={!filter.stages}
              href={href({ ...filter, stages: undefined }, { view: viewParam })}
            />
            {DEAL_STAGES.map((stage) => (
              <StageTab
                key={stage}
                label={DEAL_STAGE_LABELS[stage]}
                active={filter.stages?.length === 1 && filter.stages[0] === stage}
                href={href({ ...filter, stages: [stage] }, { view: viewParam })}
              />
            ))}
          </div>
        </div>

        {chips.length > 0 && (
          <div className="bg-ai-soft/60 border-ai-border/60 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
            {why && (
              <span className="text-ai flex items-center gap-1.5 text-xs font-medium">
                <Sparkles className="size-3.5" />
                {why}
              </span>
            )}
            <div className="flex flex-wrap gap-1.5">
              {chips.map((chip) => {
                const next: DealFilter = { ...filter, [chip.key]: undefined };
                if (chip.key === 'sortBy') next.sortDir = undefined;
                return (
                  <Link
                    key={chip.key}
                    href={href(next, { view: viewParam })}
                    className="bg-card hover:border-foreground/30 flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs"
                  >
                    {chip.label}
                    <X className="text-muted-foreground size-3" />
                  </Link>
                );
              })}
            </div>
            <Link
              href={view === 'board' ? '/deals?view=board' : '/deals'}
              className="text-muted-foreground hover:text-foreground ml-auto text-xs"
            >
              Clear all
            </Link>
          </div>
        )}

        {result.items.length === 0 ? (
          <Card className="text-muted-foreground p-10 text-center text-sm">
            No deals match these filters.
          </Card>
        ) : view === 'board' ? (
          <DealsBoard deals={result.items} />
        ) : (
          <Card className="overflow-hidden">
            <DealsTable deals={result.items} />
          </Card>
        )}
      </div>
    </>
  );
}

function StageTab({ label, active, href }: { label: string; active: boolean; href: string }) {
  return (
    <Link
      href={href}
      className={cn(
        'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-card text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </Link>
  );
}
