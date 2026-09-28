import type { CompanyDetail } from '@crm/shared';
import { ArrowLeft, Globe, MapPin, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ActivityTimeline } from '@/components/activity-timeline';
import { NotesSummaryCard } from '@/components/companies/notes-summary-card';
import { AskAboutButton } from '@/components/copilot/copilot-provider';
import { AddActivityForm } from '@/components/deals/add-activity-form';
import { DealsTable } from '@/components/deals/deals-table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { formatNumber, formatUsd } from '@/lib/format';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const company = await api<CompanyDetail>(`/companies/${(await params).id}`);
  return { title: company.name };
}

export default async function CompanyPage({ params }: Props) {
  const company = await api<CompanyDetail>(`/companies/${(await params).id}`);

  return (
    <>
      <Link
        href="/companies"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> Companies
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{company.name}</h1>
          <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {company.industry && <span>{company.industry}</span>}
            {company.city && (
              <span className="flex items-center gap-1">
                <MapPin className="size-3.5" />
                {company.city}, {company.country}
              </span>
            )}
            {company.employees && (
              <span className="flex items-center gap-1">
                <Users className="size-3.5" />
                {formatNumber(company.employees)} employees
              </span>
            )}
            {company.domain && (
              <span className="flex items-center gap-1">
                <Globe className="size-3.5" />
                {company.domain}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-muted-foreground text-xs">Open pipeline</p>
            <p className="text-lg font-semibold tabular-nums">{formatUsd(company.openPipeline)}</p>
          </div>
          <AskAboutButton
            label="Ask copilot"
            question={`Summarize my last interactions with ${company.name}`}
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <NotesSummaryCard companyId={company.id} />
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Deals</CardTitle>
            </CardHeader>
            {company.deals.length > 0 ? (
              <DealsTable deals={company.deals} showCompany={false} />
            ) : (
              <CardContent className="text-muted-foreground text-sm">No deals yet.</CardContent>
            )}
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <AddActivityForm companyId={company.id} />
              <ActivityTimeline activities={company.activities} showDeal />
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Contacts</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {company.contacts.map((c) => (
                <li key={c.id} className="flex items-center gap-3">
                  <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                    {c.firstName[0]}
                    {c.lastName[0]}
                  </span>
                  <div className="min-w-0 text-sm">
                    <p className="font-medium">
                      {c.firstName} {c.lastName}
                    </p>
                    <p className="text-muted-foreground truncate text-xs">{c.title}</p>
                    <a
                      href={`mailto:${c.email}`}
                      className="text-muted-foreground truncate text-xs hover:underline"
                    >
                      {c.email}
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
