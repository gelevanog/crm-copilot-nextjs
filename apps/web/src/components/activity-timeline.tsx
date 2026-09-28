import type { Activity, ActivityType } from '@crm/shared';
import { CalendarCheck, CheckSquare, Mail, Phone, StickyNote } from 'lucide-react';
import Link from 'next/link';
import { formatDate } from '@/lib/format';

const ICON: Record<ActivityType, typeof Mail> = {
  NOTE: StickyNote,
  CALL: Phone,
  EMAIL: Mail,
  MEETING: CalendarCheck,
  TASK: CheckSquare,
};

export function ActivityTimeline({
  activities,
  showDeal = false,
}: {
  activities: Activity[];
  showDeal?: boolean;
}) {
  if (activities.length === 0) {
    return <p className="text-muted-foreground py-6 text-center text-sm">No activities yet.</p>;
  }
  return (
    <ol className="before:bg-border relative space-y-5 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px">
      {activities.map((a) => {
        const Icon = ICON[a.type];
        return (
          <li key={a.id} className="relative flex gap-3">
            <span className="bg-card z-10 flex size-8 shrink-0 items-center justify-center rounded-full border">
              <Icon className="text-muted-foreground size-3.5" />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="text-sm font-medium">{a.subject}</p>
                <time className="text-muted-foreground whitespace-nowrap text-xs">
                  {formatDate(a.occurredAt)}
                </time>
              </div>
              <p className="text-muted-foreground text-xs">
                {a.type.charAt(0) + a.type.slice(1).toLowerCase()} by {a.author.name}
                {showDeal && a.deal && (
                  <>
                    {' · '}
                    <Link href={`/deals/${a.deal.id}`} className="hover:underline">
                      {a.deal.title}
                    </Link>
                  </>
                )}
              </p>
              {a.body && <p className="mt-1.5 text-sm leading-relaxed">{a.body}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
