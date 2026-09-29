import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ChatStreamEvent } from '@crm/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AI_RATE_LIMITER } from '../src/ai/rate-limit/ai-rate-limit.guard';
import { TokenBucketRateLimiter } from '../src/ai/rate-limit/token-bucket';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.module';
import { seedDatabase } from '../src/seed/seed';
import { prepareTestDatabase } from './helpers/db';

const dbAvailable = await prepareTestDatabase();
const RATE_LIMIT = 6;

function parseNdjson(body: string): ChatStreamEvent[] {
  return body
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ChatStreamEvent);
}

describe.skipIf(!dbAvailable)('AI endpoints e2e (fake provider, Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let workspaceId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_RATE_LIMITER)
      .useValue(new TokenBucketRateLimiter({ capacity: RATE_LIMIT, refillPerMinute: 0.001 }))
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    prisma = app.get(PrismaService);
    await seedDatabase(prisma, { reset: true });

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'alex@northwind.test', password: 'demo1234' })
      .expect(200);
    token = login.body.accessToken;
    workspaceId = login.body.user.workspace.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('rejects unauthenticated requests', async () => {
    await request(app.getHttpServer()).post('/ai/chat').send({}).expect(401);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'alex@northwind.test', password: 'wrong' })
      .expect(401);
  });

  it('validates the chat request body', async () => {
    const res = await request(app.getHttpServer())
      .post('/ai/chat')
      .set(auth())
      .send({ message: '   ' })
      .expect(400);
    expect(res.body.message).toBe('Validation failed');
    await request(app.getHttpServer())
      .post('/ai/chat')
      .set(auth())
      .send({ message: 'hi', workspaceId: 'someone-else' })
      .expect(400);
  });

  it('streams tool calls, tool results and the answer as NDJSON', async () => {
    const res = await request(app.getHttpServer())
      .post('/ai/chat')
      .set(auth())
      .send({ message: 'Which deals over $20k are stuck in Negotiation for more than 2 weeks?' })
      .expect(200)
      .expect('Content-Type', /application\/x-ndjson/);

    const events = parseNdjson(res.text);
    const call = events.find((e) => e.type === 'tool_call');
    const result = events.find((e) => e.type === 'tool_result');
    const done = events.at(-1);

    expect(call).toMatchObject({
      name: 'searchDeals',
      input: { stages: ['NEGOTIATION'], minAmount: 20000, stuckForDays: 14 },
    });
    expect(result).toMatchObject({ ok: true, summary: '3 deals found' });
    expect(result?.type === 'tool_result' && result.table?.rows).toHaveLength(3);
    const text = events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
    expect(text).toContain('**Claims automation suite**');
    expect(done).toMatchObject({ type: 'done', provider: 'fake', model: 'fake-rules-v1' });

    const usage = await prisma.aiUsage.findFirst({
      where: { workspaceId, feature: 'chat' },
      orderBy: { createdAt: 'desc' },
    });
    expect(usage).toMatchObject({ success: true, toolCalls: 1, provider: 'fake' });
    expect(usage?.inputTokens).toBeGreaterThan(0);
  });

  it('converts natural language into a filter the Deals list accepts', async () => {
    const parsed = await request(app.getHttpServer())
      .post('/ai/parse-filter')
      .set(auth())
      .send({ text: 'negotiation deals over $50k' })
      .expect(200);
    expect(parsed.body.filter).toEqual({ stages: ['NEGOTIATION'], minAmount: 50000 });

    const list = await request(app.getHttpServer())
      .get('/deals')
      .query({ stages: 'NEGOTIATION', minAmount: 50000 })
      .set(auth())
      .expect(200);
    expect(list.body.items.map((d: { title: string }) => d.title)).toEqual([
      'Claims automation suite',
      'Store analytics platform',
      'Predictive maintenance pilot',
    ]);
  });

  it('drafts a structured follow-up email for a deal', async () => {
    const deal = await prisma.deal.findFirstOrThrow({
      where: { workspaceId, title: 'Fleet telematics rollout' },
    });
    const res = await request(app.getHttpServer())
      .post(`/ai/deals/${deal.id}/follow-up`)
      .set(auth())
      .send({ tone: 'concise' })
      .expect(200);
    expect(res.body.subject).toContain('Fleet telematics rollout');
    expect(res.body.body).toMatch(/^Hi Dana,/);
  });

  it("returns 404 for another workspace's deal", async () => {
    const foreign = await prisma.deal.findFirstOrThrow({
      where: { workspaceId: { not: workspaceId } },
    });
    await request(app.getHttpServer())
      .post(`/ai/deals/${foreign.id}/follow-up`)
      .set(auth())
      .send({ tone: 'friendly' })
      .expect(404);
  });

  it('rate limits AI endpoints per workspace with 429 + Retry-After', async () => {
    let last: request.Response | undefined;
    for (let i = 0; i < RATE_LIMIT + 1; i++) {
      last = await request(app.getHttpServer())
        .post('/ai/parse-filter')
        .set(auth())
        .send({ text: 'won deals' });
    }
    expect(last?.status).toBe(429);
    expect(last?.headers['retry-after']).toBeDefined();
    expect(last?.body.code).toBe('rate_limited');
  });

  it('reports usage per feature', async () => {
    const res = await request(app.getHttpServer()).get('/ai/usage').set(auth()).expect(200);
    const chat = res.body.byFeature.find((f: { feature: string }) => f.feature === 'chat');
    expect(chat.calls).toBeGreaterThanOrEqual(1);
    expect(res.body.daily).toHaveLength(14);
  });
});
