import type { PrismaClient } from '@prisma/client';
import { hashPassword } from '../auth/password';
import { daysAgo, daysFromNow } from '../common/mappers';
import { DEMO_PASSWORD, STAGE_HISTORY, WORKSPACES } from './data';

export interface SeedOptions {
  /** Wipe existing data first. Without it, seeding is skipped when demo data exists. */
  reset?: boolean;
  now?: Date;
  log?: (message: string) => void;
}

export async function seedDatabase(prisma: PrismaClient, opts: SeedOptions = {}): Promise<void> {
  const log = opts.log ?? (() => undefined);
  const now = opts.now ?? new Date();

  if (!opts.reset) {
    const existing = await prisma.workspace.count({
      where: { slug: { in: WORKSPACES.map((w) => w.slug) } },
    });
    if (existing > 0) {
      log('Demo data already present, skipping seed (use --reset to recreate).');
      return;
    }
  } else {
    // Children first: some relations (deal owner, activity author) are RESTRICT.
    await prisma.$transaction([
      prisma.aiUsage.deleteMany(),
      prisma.activity.deleteMany(),
      prisma.deal.deleteMany(),
      prisma.contact.deleteMany(),
      prisma.company.deleteMany(),
      prisma.user.deleteMany(),
      prisma.workspace.deleteMany(),
    ]);
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  for (const ws of WORKSPACES) {
    const workspace = await prisma.workspace.create({ data: { name: ws.name, slug: ws.slug } });
    const workspaceId = workspace.id;

    const users = new Map<string, string>();
    for (const u of ws.users) {
      const user = await prisma.user.create({
        data: { workspaceId, email: u.email, name: u.name, passwordHash },
      });
      users.set(u.key, user.id);
    }
    const userId = (key: string) => {
      const id = users.get(key);
      if (!id) throw new Error(`Unknown seed user ${key}`);
      return id;
    };

    const companies = new Map<string, { id: string; contactIds: string[] }>();
    for (const c of ws.companies) {
      const company = await prisma.company.create({
        data: {
          workspaceId,
          name: c.name,
          domain: c.domain,
          industry: c.industry,
          employees: c.employees,
          city: c.city,
          country: c.country,
          createdAt: daysAgo(180, now),
        },
      });
      const contactIds: string[] = [];
      for (const p of c.contacts) {
        const contact = await prisma.contact.create({
          data: {
            workspaceId,
            companyId: company.id,
            firstName: p.firstName,
            lastName: p.lastName,
            title: p.title,
            phone: p.phone ?? null,
            email: `${p.firstName}.${p.lastName}@${c.domain}`.toLowerCase(),
          },
        });
        contactIds.push(contact.id);
      }
      companies.set(c.name, { id: company.id, contactIds });
    }
    const companyOf = (name: string) => {
      const c = companies.get(name);
      if (!c) throw new Error(`Unknown seed company ${name}`);
      return c;
    };

    const deals = new Map<string, { id: string; contactId: string | null }>();
    for (const d of ws.deals) {
      const company = companyOf(d.company);
      const contactId = company.contactIds[0] ?? null;
      const stageChangedAt = daysAgo(d.daysInStage, now);
      const createdAt = daysAgo(d.daysInStage + 20 + (d.amount % 17), now);
      const deal = await prisma.deal.create({
        data: {
          workspaceId,
          companyId: company.id,
          contactId,
          ownerId: userId(d.owner),
          title: d.title,
          amount: d.amount,
          stage: d.stage,
          stageChangedAt,
          expectedCloseDate: daysFromNow(d.closeInDays, now),
          createdAt,
        },
      });
      deals.set(d.title, { id: deal.id, contactId });

      // Generated history between deal creation and the last stage change.
      const history = STAGE_HISTORY[d.stage];
      const span = d.daysInStage + 20;
      await prisma.activity.createMany({
        data: history.map((h, i) => ({
          workspaceId,
          companyId: company.id,
          dealId: deal.id,
          contactId,
          authorId: userId(d.owner),
          type: h.type,
          subject: h.subject,
          body: h.body,
          occurredAt: daysAgo(
            d.daysInStage + Math.round((span - d.daysInStage) * (1 - (i + 1) / history.length)),
            now,
          ),
        })),
      });
    }

    for (const a of ws.activities) {
      const company = companyOf(a.company);
      const deal = a.deal ? deals.get(a.deal) : undefined;
      await prisma.activity.create({
        data: {
          workspaceId,
          companyId: company.id,
          dealId: deal?.id ?? null,
          contactId: deal?.contactId ?? company.contactIds[0] ?? null,
          authorId: userId(a.author),
          type: a.type,
          subject: a.subject,
          body: a.body ?? null,
          occurredAt: daysAgo(a.daysAgo, now),
        },
      });
    }

    log(
      `Seeded workspace "${ws.name}": ${ws.users.length} users, ${ws.companies.length} companies, ${ws.deals.length} deals.`,
    );
  }
}
