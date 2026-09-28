import type { DealDetail } from '@crm/shared';
import { ArrowLeft, Building2, CalendarDays, Clock, User } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ActivityTimeline } from '@/components/activity-timeline';
import { AskAboutButton } from '@/components/copilot/copilot-provider';
import { AddActivityForm } from '@/components/deals/add-activity-form';
import { FollowUpCard } from '@/components/deals/follow-up-card';
import { StageSelect } from '@/components/deals/stage-select';
import { StageBadge } from '@/components/stage-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { formatDate, formatUsd } from '@/lib/format';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const deal = await api<DealDetail>(`/deals/${(await params).id}`);
  return { title: deal.title };
}

export default async function DealPage({ params }: Props) {
  const deal = await api<DealDetail>(`/deals/${(await params).id}`);

  return (
    <>
      <Link
        href="/deals"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> Deals
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{deal.title}</h1>
            <StageBadge stage={deal.stage} />
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            <Link href={`/companies/${deal.company.id}`} className="hover:underline">
              {deal.company.name}
            </Link>
            {' · '}
            <span className="text-foreground font-medium">{formatUsd(deal.amount)}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AskAboutButton
            label="Ask about this account"
            question={`Summarize my last interactions with ${deal.company.name}`}
          />
          <StageSelect dealId={deal.id} stage={deal.stage} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <FollowUpCard dealId={deal.id} />
          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <AddActivityForm dealId={deal.id} />
              <ActivityTimeline activities={deal.activities} />
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <Detail icon={<Building2 />} label="Company">
                <Link href={`/companies/${deal.company.id}`} className="hover:underline">
                  {deal.company.name}
                </Link>
              </Detail>
              <Detail icon={<User />} label="Contact">
                {deal.contact ? (
                  <>
                    {deal.contact.firstName} {deal.contact.lastName}
                    <span className="text-muted-foreground block text-xs">
                      {deal.contact.title} · {deal.contact.email}
                    </span>
                  </>
                ) : (
                  '—'
                )}
              </Detail>
              <Detail icon={<User />} label="Owner">
                {deal.owner.name}
              </Detail>
              <Detail icon={<Clock />} label="In current stage">
                <span
                  className={
                    deal.daysInStage > 14 && deal.stage !== 'WON' && deal.stage !== 'LOST'
                      ? 'font-medium text-amber-600'
                      : ''
                  }
                >
                  {deal.daysInStage} days
                </span>
              </Detail>
              <Detail icon={<CalendarDays />} label="Expected close">
                {formatDate(deal.expectedCloseDate)}
              </Detail>
              <Detail icon={<CalendarDays />} label="Created">
                {formatDate(deal.createdAt)}
              </Detail>
            </dl>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Detail({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <span className="text-muted-foreground mt-0.5 [&_svg]:size-4">{icon}</span>
      <div className="min-w-0">
        <dt className="text-muted-foreground text-xs">{label}</dt>
        <dd>{children}</dd>
      </div>
    </div>
  );
}
