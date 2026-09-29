import { ActivitiesService } from '../../src/activities/activities.service';
import { ProposedActionsService } from '../../src/ai/actions/proposed-actions.service';
import { ConversationsService } from '../../src/ai/conversations/conversations.service';
import { CrmToolsService } from '../../src/ai/tools/crm-tools';
import { CompaniesService } from '../../src/companies/companies.service';
import { loadEnv } from '../../src/config/env';
import { DealsService } from '../../src/deals/deals.service';
import type { PrismaService } from '../../src/prisma/prisma.module';

/** The CRM + AI service graph wired by hand (no Nest container) for DB-backed tests. */
export function createServices(prisma: PrismaService) {
  const env = loadEnv();
  const deals = new DealsService(prisma);
  const companies = new CompaniesService(prisma);
  const activities = new ActivitiesService(prisma);
  const conversations = new ConversationsService(prisma);
  const proposals = new ProposedActionsService(
    prisma,
    deals,
    companies,
    activities,
    conversations,
    env,
  );
  const tools = new CrmToolsService(deals, companies, activities, proposals);
  return { env, deals, companies, activities, conversations, proposals, tools };
}
