import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type {
  ChatStreamEvent,
  ConversationDetail,
  ConversationSummary,
  ProposedActionView,
} from '@crm/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.module';
import { seedDatabase } from '../src/seed/seed';
import { prepareTestDatabase } from './helpers/db';

const dbAvailable = await prepareTestDatabase();

function parseNdjson(body: string): ChatStreamEvent[] {
  return body
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ChatStreamEvent);
}

const answerText = (events: ChatStreamEvent[]) =>
  events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');

describe.skipIf(!dbAvailable)('Saved conversations and write actions e2e (fake provider)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tokens: Record<'alex' | 'sam' | 'jordan', string> = { alex: '', sam: '', jordan: '' };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    prisma = app.get(PrismaService);
    await seedDatabase(prisma, { reset: true });

    for (const [key, email] of [
      ['alex', 'alex@northwind.test'],
      ['sam', 'sam@northwind.test'],
      ['jordan', 'jordan@globex.test'],
    ] as const) {
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'demo1234' })
        .expect(200);
      tokens[key] = login.body.accessToken;
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  const as = (who: keyof typeof tokens) => ({ Authorization: `Bearer ${tokens[who]}` });

  async function chat(who: keyof typeof tokens, message: string, conversationId?: string) {
    const res = await request(app.getHttpServer())
      .post('/ai/chat')
      .set(as(who))
      .send({ message, ...(conversationId && { conversationId }) })
      .expect(200);
    const events = parseNdjson(res.text);
    const started = events[0];
    if (started?.type !== 'conversation')
      throw new Error('stream must start with the conversation');
    return { events, conversationId: started.id, title: started.title, text: answerText(events) };
  }

  describe('saved conversations', () => {
    let conversationId: string;

    it('creates a conversation titled after the first question and persists the run', async () => {
      const first = await chat('alex', 'How is the pipeline looking?');
      conversationId = first.conversationId;
      expect(first.title).toBe('How is the pipeline looking?');

      const list = await request(app.getHttpServer())
        .get('/ai/conversations')
        .set(as('alex'))
        .expect(200);
      expect((list.body as ConversationSummary[]).map((c) => c.id)).toContain(conversationId);

      const detail = await request(app.getHttpServer())
        .get(`/ai/conversations/${conversationId}`)
        .set(as('alex'))
        .expect(200);
      const { turns } = detail.body as ConversationDetail;
      expect(turns).toHaveLength(2);
      expect(turns[0]).toMatchObject({ role: 'user', content: 'How is the pipeline looking?' });
      expect(turns[1]).toMatchObject({
        role: 'assistant',
        content: first.text,
        error: null,
        meta: { model: 'fake-rules-v1' },
        tools: [{ name: 'getPipelineStats', ok: true, table: { rows: expect.any(Array) } }],
      });
    });

    it('continues a conversation with the stored history as context', async () => {
      const second = await chat('alex', 'Which deals are stuck in Negotiation?', conversationId);
      expect(second.conversationId).toBe(conversationId);

      const rows = await prisma.conversationMessage.findMany({
        where: { conversationId },
        orderBy: { seq: 'asc' },
      });
      expect(rows.map((r) => r.role)).toEqual([
        'user',
        'assistant',
        'tool_results',
        'assistant',
        'user',
        'assistant',
        'tool_results',
        'assistant',
      ]);
      expect(rows.map((r) => r.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      // The fake provider numbers tool calls by prior assistant turns, so the
      // second run only gets call_2_0 if it saw the first run's history.
      expect(second.events.find((e) => e.type === 'tool_call')).toMatchObject({ id: 'call_2_0' });
    });

    it('renames and deletes a conversation', async () => {
      const renamed = await request(app.getHttpServer())
        .patch(`/ai/conversations/${conversationId}`)
        .set(as('alex'))
        .send({ title: 'Pipeline review' })
        .expect(200);
      expect(renamed.body).toMatchObject({ id: conversationId, title: 'Pipeline review' });
      await request(app.getHttpServer())
        .patch(`/ai/conversations/${conversationId}`)
        .set(as('alex'))
        .send({ title: '' })
        .expect(400);

      await request(app.getHttpServer())
        .delete(`/ai/conversations/${conversationId}`)
        .set(as('alex'))
        .expect(204);
      await request(app.getHttpServer())
        .get(`/ai/conversations/${conversationId}`)
        .set(as('alex'))
        .expect(404);
      expect(await prisma.conversationMessage.count({ where: { conversationId } })).toBe(0);
    });

    it("isolates conversations per user and workspace: others can't read, append, rename or delete", async () => {
      const own = await chat('alex', 'Summarize my last interactions with Acme');
      const id = own.conversationId;
      const before = await prisma.conversationMessage.count({ where: { conversationId: id } });

      for (const intruder of ['sam', 'jordan'] as const) {
        const server = app.getHttpServer();
        await request(server).get(`/ai/conversations/${id}`).set(as(intruder)).expect(404);
        await request(server)
          .post('/ai/chat')
          .set(as(intruder))
          .send({ conversationId: id, message: 'What did we discuss?' })
          .expect(404);
        await request(server)
          .patch(`/ai/conversations/${id}`)
          .set(as(intruder))
          .send({ title: 'mine now' })
          .expect(404);
        await request(server).delete(`/ai/conversations/${id}`).set(as(intruder)).expect(404);

        const list = await request(server).get('/ai/conversations').set(as(intruder)).expect(200);
        expect((list.body as ConversationSummary[]).map((c) => c.id)).not.toContain(id);
      }

      expect(await prisma.conversationMessage.count({ where: { conversationId: id } })).toBe(
        before,
      );
      const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id } });
      expect(conversation.title).toBe('Summarize my last interactions with Acme');
    });
  });

  describe('write actions behind confirmation', () => {
    it('propose -> approve -> deal updated, and the model learns the outcome', async () => {
      const deal = await prisma.deal.findFirstOrThrow({
        where: { title: 'Fleet telematics rollout' },
      });

      const proposed = await chat('alex', 'Move the Acme deal to Proposal');
      expect(proposed.events.find((e) => e.type === 'tool_call')).toMatchObject({
        name: 'proposeDealStageChange',
        input: { deal: 'Acme', stage: 'PROPOSAL' },
      });
      const result = proposed.events.find((e) => e.type === 'tool_result');
      const proposal = (result?.type === 'tool_result' && result.proposal) as ProposedActionView;
      expect(proposal).toMatchObject({
        status: 'pending',
        target: { href: `/deals/${deal.id}` },
        changes: [{ field: 'stage', before: 'Negotiation', after: 'Proposal' }],
      });
      expect(proposed.text).toContain('Nothing has been changed yet');

      // The model's turn is over and nothing changed.
      const unchanged = await request(app.getHttpServer())
        .get(`/deals/${deal.id}`)
        .set(as('alex'))
        .expect(200);
      expect(unchanged.body.stage).toBe('NEGOTIATION');

      const approved = await request(app.getHttpServer())
        .post(`/ai/actions/${proposal.id}/approve`)
        .set(as('alex'))
        .expect(200);
      expect(approved.body).toMatchObject({ id: proposal.id, status: 'approved' });

      const updated = await request(app.getHttpServer())
        .get(`/deals/${deal.id}`)
        .set(as('alex'))
        .expect(200);
      expect(updated.body.stage).toBe('PROPOSAL');

      // A second click is a conflict carrying the current state.
      const again = await request(app.getHttpServer())
        .post(`/ai/actions/${proposal.id}/reject`)
        .set(as('alex'))
        .expect(409);
      expect(again.body).toMatchObject({
        code: 'proposal_not_pending',
        proposal: { status: 'approved' },
      });

      // The saved conversation re-renders the card with its current status...
      const detail = await request(app.getHttpServer())
        .get(`/ai/conversations/${proposed.conversationId}`)
        .set(as('alex'))
        .expect(200);
      const tools = (detail.body as ConversationDetail).turns.flatMap((t) =>
        t.role === 'assistant' ? t.tools : [],
      );
      expect(tools[0]?.proposal).toMatchObject({ id: proposal.id, status: 'approved' });

      // ...and the next model turn sees the outcome note.
      const followUp = await chat('alex', 'Did that change go through?', proposed.conversationId);
      expect(followUp.text).toContain('The user approved the proposal "Move deal to Proposal"');
    });

    it("cross-tenant: another user's or workspace's approve/reject is a 404 and changes nothing", async () => {
      const proposed = await chat('alex', 'Set the amount of Patient intake portal to $70k');
      const result = proposed.events.find((e) => e.type === 'tool_result');
      const proposal = (result?.type === 'tool_result' && result.proposal) as ProposedActionView;
      expect(proposal.status).toBe('pending');

      for (const intruder of ['sam', 'jordan'] as const) {
        for (const action of ['approve', 'reject']) {
          await request(app.getHttpServer())
            .post(`/ai/actions/${proposal.id}/${action}`)
            .set(as(intruder))
            .expect(404);
        }
      }
      const row = await prisma.proposedAction.findUniqueOrThrow({ where: { id: proposal.id } });
      expect(row.status).toBe('pending');
      await request(app.getHttpServer()).post(`/ai/actions/${proposal.id}/approve`).expect(401);
    });

    it('reject leaves the record untouched', async () => {
      const proposed = await chat('alex', 'Log a note on Acme: Dana asked for revised pricing');
      const result = proposed.events.find((e) => e.type === 'tool_result');
      const proposal = (result?.type === 'tool_result' && result.proposal) as ProposedActionView;
      expect(proposal).toMatchObject({ kind: 'activity', target: { label: 'Acme Logistics' } });

      await request(app.getHttpServer())
        .post(`/ai/actions/${proposal.id}/reject`)
        .set(as('alex'))
        .expect(200);
      expect(
        await prisma.activity.count({ where: { subject: 'Dana asked for revised pricing' } }),
      ).toBe(0);
    });
  });
});
