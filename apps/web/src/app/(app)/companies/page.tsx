import type { CompanyListItem } from '@crm/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { Table, TD, TH, THead, TRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatNumber, formatRelative, formatUsd } from '@/lib/format';

export const metadata: Metadata = { title: 'Companies' };

export default async function CompaniesPage() {
  const companies = await api<CompanyListItem[]>('/companies');
  return (
    <>
      <PageHeader title="Companies" description={`${companies.length} accounts`} />
      <Card className="overflow-hidden">
        <Table>
          <THead>
            <tr>
              <TH>Company</TH>
              <TH>Industry</TH>
              <TH className="text-right">Employees</TH>
              <TH className="text-right">Open deals</TH>
              <TH className="text-right">Open pipeline</TH>
              <TH>Last activity</TH>
            </tr>
          </THead>
          <tbody>
            {companies.map((c) => (
              <TRow key={c.id} className="hover:bg-muted/40">
                <TD>
                  <Link href={`/companies/${c.id}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                  <p className="text-muted-foreground text-xs">
                    {[c.city, c.country].filter(Boolean).join(', ')}
                  </p>
                </TD>
                <TD className="text-muted-foreground">{c.industry ?? '—'}</TD>
                <TD className="text-right tabular-nums">
                  {c.employees ? formatNumber(c.employees) : '—'}
                </TD>
                <TD className="text-right tabular-nums">{c.openDeals}</TD>
                <TD className="text-right font-medium tabular-nums">{formatUsd(c.openPipeline)}</TD>
                <TD className="text-muted-foreground">{formatRelative(c.lastActivityAt)}</TD>
              </TRow>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
