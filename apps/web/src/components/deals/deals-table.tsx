import type { DealListItem } from '@crm/shared';
import Link from 'next/link';
import { StageBadge } from '@/components/stage-badge';
import { Table, TD, TH, THead, TRow } from '@/components/ui/table';
import { formatDate, formatUsd } from '@/lib/format';
import { cn } from '@/lib/utils';

export function DealsTable({
  deals,
  showCompany = true,
}: {
  deals: DealListItem[];
  showCompany?: boolean;
}) {
  return (
    <Table>
      <THead>
        <tr>
          <TH>Deal</TH>
          <TH>Stage</TH>
          <TH className="text-right">Amount</TH>
          <TH className="text-right">In stage</TH>
          <TH>Expected close</TH>
          <TH>Owner</TH>
        </tr>
      </THead>
      <tbody>
        {deals.map((deal) => {
          const open = deal.stage !== 'WON' && deal.stage !== 'LOST';
          return (
            <TRow key={deal.id} className="hover:bg-muted/40">
              <TD>
                <Link href={`/deals/${deal.id}`} className="font-medium hover:underline">
                  {deal.title}
                </Link>
                {showCompany && (
                  <Link
                    href={`/companies/${deal.company.id}`}
                    className="text-muted-foreground block text-xs hover:underline"
                  >
                    {deal.company.name}
                  </Link>
                )}
              </TD>
              <TD>
                <StageBadge stage={deal.stage} />
              </TD>
              <TD className="text-right font-medium tabular-nums">{formatUsd(deal.amount)}</TD>
              <TD
                className={cn(
                  'text-right tabular-nums',
                  open && deal.daysInStage > 14
                    ? 'font-medium text-amber-600'
                    : 'text-muted-foreground',
                )}
              >
                {deal.daysInStage}d
              </TD>
              <TD className="text-muted-foreground whitespace-nowrap">
                {formatDate(deal.expectedCloseDate)}
              </TD>
              <TD className="text-muted-foreground whitespace-nowrap">{deal.owner.name}</TD>
            </TRow>
          );
        })}
      </tbody>
    </Table>
  );
}
