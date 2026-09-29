/**
 * Runs copilot questions through the real services (agent loop, tools,
 * saved conversation, proposals) against the seeded database and prints a
 * Markdown transcript (used for the README examples).
 *
 *   pnpm --filter @crm/api transcript "Which deals over $20k are stuck in Negotiation for more than 2 weeks?"
 *   pnpm --filter @crm/api transcript "Move the Acme deal to Proposal" --approve "Did that go through?"
 *   pnpm --filter @crm/api transcript --filter "my open deals over 25k closing this month"
 *
 * All questions go to one conversation. `--approve` / `--reject` decide the
 * proposals made by the previous question, exactly like the buttons on the
 * confirmation card; approving writes to the database (`db:reset` restores
 * the demo data). Uses LLM_PROVIDER from the environment, so the same script
 * works with `fake`, `openai` or `anthropic`.
 */
import { Logger } from '@nestjs/common';
import type { ChatStreamEvent, ConversationSummary, ProposedActionView } from '@crm/shared';
import { ActivitiesService } from '../src/activities/activities.service';
import { ProposedActionsService } from '../src/ai/actions/proposed-actions.service';
import { AiService } from '../src/ai/ai.service';
import { ConversationsService } from '../src/ai/conversations/conversations.service';
import { createLlmProvider } from '../src/ai/llm/llm.factory';
import { CrmToolsService } from '../src/ai/tools/crm-tools';
import { UsageService } from '../src/ai/usage/usage.service';
import type { AuthUser } from '../src/common/auth-user';
import { CompaniesService } from '../src/companies/companies.service';
import { loadDotEnvFile, loadEnv } from '../src/config/env';
import { DealsService } from '../src/deals/deals.service';
import { PrismaService } from '../src/prisma/prisma.module';

type Step = { kind: 'ask' | 'filter'; text: string } | { kind: 'approve' | 'reject' };

function parseSteps(args: string[]): Step[] {
  const steps: Step[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--approve' || a === '--reject')
      steps.push({ kind: a === '--approve' ? 'approve' : 'reject' });
    else if (a === '--filter') steps.push({ kind: 'filter', text: args[++i] ?? '' });
    else steps.push({ kind: 'ask', text: a });
  }
  return steps;
}

function card(p: ProposedActionView): string {
  const rows = p.changes
    .map((c) =>
      c.before === null ? `${c.label}: ${c.after}` : `${c.label}: ${c.before} → ${c.after}`,
    )
    .join(', ');
  return `**${p.title}** · ${p.target.label} · ${rows} · status \`${p.status}\``;
}

async function main(): Promise<void> {
  loadDotEnvFile();
  const steps = parseSteps(process.argv.slice(2));
  if (steps.length === 0) throw new Error('Pass one or more questions');

  // Wired by hand: tsx does not emit the decorator metadata Nest's DI relies on.
  Logger.overrideLogger(false);
  const env = loadEnv();
  const prisma = new PrismaService();
  const deals = new DealsService(prisma);
  const companies = new CompaniesService(prisma);
  const activities = new ActivitiesService(prisma);
  const conversations = new ConversationsService(prisma);
  const actions = new ProposedActionsService(
    prisma,
    deals,
    companies,
    activities,
    conversations,
    env,
  );
  const ai = new AiService(
    createLlmProvider({ ...env, NODE_ENV: 'test' }),
    env,
    new CrmToolsService(deals, companies, activities, actions),
    new UsageService(prisma, env),
    deals,
    companies,
    conversations,
  );
  try {
    const row = await prisma.user.findUniqueOrThrow({ where: { email: 'alex@northwind.test' } });
    const user: AuthUser = {
      userId: row.id,
      workspaceId: row.workspaceId,
      email: row.email,
      name: row.name,
    };

    let conversation: ConversationSummary | undefined;
    let pending: ProposedActionView[] = [];
    const out: string[] = [];

    for (const step of steps) {
      if (step.kind === 'filter') {
        const parsed = await ai.parseDealFilter(user, step.text);
        const usage = await prisma.aiUsage.findFirstOrThrow({
          where: { userId: user.userId, feature: 'nl_filter' },
          orderBy: { createdAt: 'desc' },
        });
        out.push(
          `**Deals filter box (${user.name}):** ${step.text}`,
          '',
          `> \`POST /ai/parse-filter\` -> \`${JSON.stringify(parsed.filter)}\``,
          `> explanation (${usage.provider}/${usage.model}): ${parsed.explanation}`,
          '',
        );
        continue;
      }
      if (step.kind !== 'ask') {
        for (const p of pending) {
          const decided =
            step.kind === 'approve'
              ? await actions.approve(user, p.id)
              : await actions.reject(user, p.id);
          out.push(
            `> **${user.name} clicks ${step.kind === 'approve' ? 'Approve' : 'Reject'}** -> \`POST /ai/actions/:id/${step.kind}\` -> status \`${decided.status}\``,
            '',
          );
        }
        pending = [];
        continue;
      }

      conversation ??= await conversations.create(user, step.text);
      const events: ChatStreamEvent[] = [];
      await ai.chat(user, conversation, step.text, (e) => events.push(e));

      out.push(`**User (${user.name}):** ${step.text}`);
      let model = '';
      for (const e of events) {
        if (e.type === 'tool_call' && !out.at(-1)?.startsWith('>')) out.push('');
        if (e.type === 'tool_call')
          out.push(`> tool call: \`${e.name}(${JSON.stringify(e.input)})\``);
        if (e.type === 'tool_result') {
          out.push(`> tool result: ${e.ok ? 'ok' : 'error'}, ${e.summary}`);
          if (e.proposal) {
            out.push(`> confirmation card: ${card(e.proposal)}`);
            pending.push(e.proposal);
          }
        }
        if (e.type === 'done') model = `${e.provider}/${e.model}`;
        if (e.type === 'error') out.push(`> error: ${e.code}: ${e.message}`);
      }
      const answer = events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
      out.push('', `**Copilot (${model}):**`, '', answer, '');
    }
    console.log(out.join('\n'));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
