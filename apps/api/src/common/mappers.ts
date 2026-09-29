import type { Prisma } from '@prisma/client';
import type { Activity, Contact, DealListItem } from '@crm/shared';

const DAY_MS = 86_400_000;

export const dealListInclude = {
  company: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true } },
} satisfies Prisma.DealInclude;

export const contactInclude = {
  company: { select: { id: true, name: true } },
} satisfies Prisma.ContactInclude;

export const activityInclude = {
  author: { select: { id: true, name: true } },
  company: { select: { id: true, name: true } },
  deal: { select: { id: true, title: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.ActivityInclude;

type DealRow = Prisma.DealGetPayload<{ include: typeof dealListInclude }>;
type ContactRow = Prisma.ContactGetPayload<{ include: typeof contactInclude }>;
type ActivityRow = Prisma.ActivityGetPayload<{ include: typeof activityInclude }>;

export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));
}

export function daysAgo(days: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

export function daysFromNow(days: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + days * DAY_MS);
}

export function toDealListItem(deal: DealRow, now: Date = new Date()): DealListItem {
  return {
    id: deal.id,
    title: deal.title,
    amount: deal.amount,
    stage: deal.stage,
    stageChangedAt: deal.stageChangedAt.toISOString(),
    daysInStage: daysBetween(deal.stageChangedAt, now),
    expectedCloseDate: deal.expectedCloseDate?.toISOString() ?? null,
    updatedAt: deal.updatedAt.toISOString(),
    company: deal.company,
    owner: deal.owner,
  };
}

export function toContact(contact: ContactRow): Contact {
  return {
    id: contact.id,
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: contact.email,
    title: contact.title,
    phone: contact.phone,
    company: contact.company,
  };
}

export function toActivity(activity: ActivityRow): Activity {
  return {
    id: activity.id,
    type: activity.type,
    subject: activity.subject,
    body: activity.body,
    occurredAt: activity.occurredAt.toISOString(),
    author: activity.author,
    company: activity.company,
    deal: activity.deal,
    contact: activity.contact
      ? {
          id: activity.contact.id,
          name: `${activity.contact.firstName} ${activity.contact.lastName}`,
        }
      : null,
  };
}
