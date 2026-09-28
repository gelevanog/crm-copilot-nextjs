/**
 * Runs copilot questions through the real agent loop against the seeded
 * database and prints a Markdown transcript (used for the README example).
 *
 *   pnpm --filter @crm/api transcript "Which deals over $20k are stuck in Negotiation for more than 2 weeks?"
 *
 * Uses LLM_PROVIDER from the environment, so the same script works with
 * `fake`, `openai` or `anthropic`.
 */
import type { ChatStreamEvent } from '@crm/shared';
import { ActivitiesService } from '../src/activities/activities.service';
import { ChatAgent } from '../src/ai/chat/chat-agent';
import { createLlmProvider } from '../src/ai/llm/llm.factory';
import { CrmToolsService } from '../src/ai/tools/crm-tools';
import { CompaniesService } from '../src/companies/companies.service';
import { loadDotEnvFile, loadEnv } from '../src/config/env';
import { DealsService } from '../src/deals/deals.service';
import { PrismaService } from '../src/prisma/prisma.module';

async function main(): Promise<void> {
  loadDotEnvFile();
  const env = loadEnv();
  const questions = process.argv.slice(2);
  if (questions.length === 0) throw new Error('Pass one or more questions as arguments');

  const prisma = new PrismaService();
  const tools = new CrmToolsService(
    new DealsService(prisma),
    new CompaniesService(prisma),
    new ActivitiesService(prisma),
  );
  const provider = createLlmProvider({ ...env, NODE_ENV: 'test' });
  const agent = new ChatAgent(provider, tools, env.AI_MAX_TOOL_ITERATIONS);
  const user = await prisma.user.findUniqueOrThrow({ where: { email: 'alex@northwind.test' } });

  try {
    for (const question of questions) {
      const events: ChatStreamEvent[] = [];
      await agent.run(
        {
          ctx: { scope: { workspaceId: user.workspaceId, userId: user.id } },
          userName: user.name,
          messages: [{ role: 'user', content: question }],
        },
        (e) => events.push(e),
      );
      const out: string[] = [`**User (${user.name}):** ${question}`, ''];
      for (const e of events) {
        if (e.type === 'tool_call')
          out.push(`> tool call: \`${e.name}(${JSON.stringify(e.input)})\``);
        if (e.type === 'tool_result')
          out.push(`> tool result: ${e.ok ? 'ok' : 'error'}, ${e.summary}`);
      }
      const answer = events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
      out.push('', `**Copilot (${provider.name}/${provider.model}):**`, '', answer, '');
      console.log(out.join('\n'));
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
