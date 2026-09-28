import { DEAL_STAGES, DEAL_STAGE_LABELS, type DealListItem } from '@crm/shared';
import Link from 'next/link';
import { STAGE_DOT } from '@/components/stage-badge';
import { formatCompactUsd } from '@/lib/format';

/** Read-only kanban view grouped by pipeline stage. */
export function DealsBoard({ deals }: { deals: DealListItem[] }) {
  return (
    <div className="grid auto-cols-[minmax(220px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2">
      {DEAL_STAGES.map((stage) => {
        const items = deals.filter((d) => d.stage === stage);
        const total = items.reduce((n, d) => n + d.amount, 0);
        return (
          <section key={stage} className="bg-muted/50 flex flex-col rounded-xl border">
            <header className="flex items-center justify-between px-3 py-2.5">
              <span className="flex items-center gap-2 text-sm font-medium">
                <span className={`size-2 rounded-full ${STAGE_DOT[stage]}`} />
                {DEAL_STAGE_LABELS[stage]}
                <span className="text-muted-foreground text-xs">{items.length}</span>
              </span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {formatCompactUsd(total)}
              </span>
            </header>
            <div className="flex-1 space-y-2 px-2 pb-2">
              {items.map((deal) => (
                <Link
                  key={deal.id}
                  href={`/deals/${deal.id}`}
                  className="bg-card shadow-xs block rounded-lg border p-3 transition-shadow hover:shadow-md"
                >
                  <p className="text-sm font-medium leading-snug">{deal.title}</p>
                  <p className="text-muted-foreground mt-0.5 text-xs">{deal.company.name}</p>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="font-medium tabular-nums">
                      {formatCompactUsd(deal.amount)}
                    </span>
                    <span
                      className={
                        deal.daysInStage > 14 && stage !== 'WON' && stage !== 'LOST'
                          ? 'text-amber-600'
                          : 'text-muted-foreground'
                      }
                    >
                      {deal.daysInStage}d in stage
                    </span>
                  </div>
                </Link>
              ))}
              {items.length === 0 && (
                <p className="text-muted-foreground px-1 py-4 text-center text-xs">No deals</p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
