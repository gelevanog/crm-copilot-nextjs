import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GetCompanyData, SearchDealsData, ToolContext } from '../src/ai/tools/crm-tools';
import { PrismaService } from '../src/prisma/prisma.module';
import { seedDatabase } from '../src/seed/seed';
import { prepareTestDatabase } from './helpers/db';
import { createServices } from './helpers/services';

const dbAvailable = await prepareTestDatabase();

describe.skipIf(!dbAvailable)('CRM tools (Postgres)', () => {
  const prisma = new PrismaService();
  const { tools, conversations } = createServices(prisma);
  let northwind: ToolContext;
  let globex: ToolContext;

  beforeAll(async () => {
    await seedDatabase(prisma, { reset: true });
    const alex = await prisma.user.findUniqueOrThrow({ where: { email: 'alex@northwind.test' } });
    const jordan = await prisma.user.findUniqueOrThrow({ where: { email: 'jordan@globex.test' } });
    const context = async (u: typeof alex): Promise<ToolContext> => {
      const scope = { workspaceId: u.workspaceId, userId: u.id };
      return { scope, conversationId: (await conversations.create(scope, 'Tools test')).id };
    };
    northwind = await context(alex);
    globex = await context(jordan);
  });

  afterAll(() => prisma.$disconnect());

  it('searchDeals applies the structured filter through the regular query layer', async () => {
    const out = await tools.execute(northwind, 'searchDeals', {
      stages: ['NEGOTIATION'],
      minAmount: 20000,
      stuckForDays: 14,
    });
    const data = out.data as SearchDealsData;
    expect(out.ok).toBe(true);
    expect(data.deals.map((d) => d.title).sort()).toEqual([
      'Claims automation suite',
      'Fleet telematics rollout',
      'Store analytics platform',
    ]);
    expect(data.deals.every((d) => d.amount >= 20000 && d.daysInStage >= 14)).toBe(true);
    expect(out.table?.rows[0]?.href).toMatch(/^\/deals\//);
  });

  it('ownedByMe is resolved from the authenticated user, not from the model', async () => {
    const out = await tools.execute(northwind, 'searchDeals', { ownedByMe: true, limit: 100 });
    const data = out.data as SearchDealsData;
    expect(data.total).toBeGreaterThan(0);
    expect(data.deals.every((d) => d.owner === 'Alex Morgan')).toBe(true);
  });

  describe('tenant isolation', () => {
    it('getCompany resolves "Acme" inside the caller workspace only', async () => {
      const a = (await tools.execute(northwind, 'getCompany', { name: 'Acme' }))
        .data as GetCompanyData;
      const b = (await tools.execute(globex, 'getCompany', { name: 'Acme' }))
        .data as GetCompanyData;
      expect(a.name).toBe('Acme Logistics');
      expect(b.name).toBe('Acme Media');
    });

    it("cannot read another workspace's company even by exact name", async () => {
      const out = await tools.execute(northwind, 'getCompany', { name: 'Orbit Telecom' });
      expect(out.ok).toBe(false);
      expect(out.data).toMatchObject({ error: 'not_found' });
    });

    it("cannot find another workspace's deals or activities", async () => {
      const deals = (await tools.execute(northwind, 'searchDeals', { text: 'Content analytics' }))
        .data as SearchDealsData;
      expect(deals.total).toBe(0);

      const acts = await tools.execute(globex, 'listActivities', { companyName: 'Acme Logistics' });
      expect(acts.data).toMatchObject({ count: 0 });
    });

    it('rejects a model-supplied workspaceId instead of honouring it', async () => {
      const out = await tools.execute(northwind, 'searchDeals', {
        workspaceId: globex.scope.workspaceId,
      });
      expect(out.ok).toBe(false);
      expect(out.data).toMatchObject({ error: 'invalid_arguments' });
    });
  });

  it('reports unknown tools and invalid arguments as tool errors', async () => {
    expect((await tools.execute(northwind, 'dropTables', {})).ok).toBe(false);
    const invalid = await tools.execute(northwind, 'listActivities', { limit: 500 });
    expect(invalid.ok).toBe(false);
    expect(invalid.summary).toContain('limit');
  });

  it('getPipelineStats aggregates per stage for the workspace', async () => {
    const out = await tools.execute(globex, 'getPipelineStats', {});
    expect(out.data).toMatchObject({ openCount: 7, openAmount: 385000 });
  });
});
