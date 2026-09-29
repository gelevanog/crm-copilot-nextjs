import type { ProposedActionView } from '@crm/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { ProposalToolData, ToolContext } from '../src/ai/tools/crm-tools';
import { PrismaService } from '../src/prisma/prisma.module';
import { seedDatabase } from '../src/seed/seed';
import { prepareTestDatabase } from './helpers/db';
import { createServices } from './helpers/services';

const dbAvailable = await prepareTestDatabase();

describe.skipIf(!dbAvailable)('Proposed write actions (Postgres)', () => {
  const prisma = new PrismaService();
  const { tools, proposals, deals, conversations } = createServices(prisma);
  let alex: ToolContext;
  let sam: ToolContext;
  let jordan: ToolContext;

  async function contextFor(email: string): Promise<ToolContext> {
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    const scope = { workspaceId: u.workspaceId, userId: u.id };
    return { scope, conversationId: (await conversations.create(scope, 'Proposals')).id };
  }

  const dealByTitle = (title: string) =>
    prisma.deal.findFirstOrThrow({ where: { title }, include: { owner: true } });

  async function propose(ctx: ToolContext, name: string, input: unknown) {
    const out = await tools.execute(ctx, name, input);
    return { ...out, proposal: out.proposal as ProposedActionView };
  }

  async function notes(ctx: ToolContext): Promise<string[]> {
    const rows = await prisma.conversationMessage.findMany({
      where: { conversationId: ctx.conversationId, role: 'note' },
      orderBy: { seq: 'asc' },
    });
    return rows.map((r) => (r.content as { text: string }).text);
  }

  beforeEach(async () => {
    await seedDatabase(prisma, { reset: true });
    alex = await contextFor('alex@northwind.test');
    sam = await contextFor('sam@northwind.test');
    jordan = await contextFor('jordan@globex.test');
  });

  afterAll(() => prisma.$disconnect());

  describe('proposing', () => {
    it('stores a pending proposal with a before/after diff and changes nothing', async () => {
      const before = await dealByTitle('Fleet telematics rollout');
      const out = await propose(alex, 'proposeDealStageChange', {
        deal: 'Acme',
        stage: 'PROPOSAL',
        reason: 'Customer asked for a revised proposal',
      });

      expect(out.ok).toBe(true);
      expect(out.proposal).toMatchObject({
        kind: 'deal_stage_change',
        status: 'pending',
        title: 'Move deal to Proposal',
        target: { label: 'Fleet telematics rollout · Acme Logistics', href: `/deals/${before.id}` },
        changes: [{ field: 'stage', before: 'Negotiation', after: 'Proposal' }],
        reason: 'Customer asked for a revised proposal',
      });
      expect(out.data as ProposalToolData).toMatchObject({
        status: 'pending_approval',
        note: expect.stringContaining('Nothing has been changed yet'),
      });

      const row = await prisma.proposedAction.findUniqueOrThrow({
        where: { id: out.proposal.id },
      });
      expect(row).toMatchObject({
        workspaceId: alex.scope.workspaceId,
        userId: alex.scope.userId,
        conversationId: alex.conversationId,
        baseVersion: before.updatedAt,
        payload: { dealId: before.id, update: { stage: 'PROPOSAL' } },
      });
      expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
      expect((await dealByTitle('Fleet telematics rollout')).stage).toBe('NEGOTIATION');
    });

    it('resolves an ambiguous company reference to the caller’s own open deal', async () => {
      // Acme has three open deals; excluding the one already in Proposal leaves
      // Alex's Fleet telematics and Sam's Driver safety training.
      const forAlex = await propose(alex, 'proposeDealStageChange', {
        deal: 'Acme',
        stage: 'PROPOSAL',
      });
      const forSam = await propose(sam, 'proposeDealStageChange', {
        deal: 'Acme',
        stage: 'PROPOSAL',
      });
      expect(forAlex.proposal.target.label).toMatch(/^Fleet telematics rollout/);
      expect(forSam.proposal.target.label).toMatch(/^Driver safety training/);
    });

    it('returns candidates instead of guessing when a reference stays ambiguous', async () => {
      const out = await tools.execute(alex, 'proposeDealUpdate', { deal: 'Acme', amount: 1 });
      expect(out.ok).toBe(false);
      expect(out.data).toMatchObject({
        error: 'ambiguous',
        candidates: expect.arrayContaining([
          expect.objectContaining({ title: 'Fleet telematics rollout' }),
          expect.objectContaining({ title: 'Warehouse dashboard add-on' }),
        ]),
      });
      expect(await prisma.proposedAction.count()).toBe(0);
    });

    it('builds a multi-field update with the owner resolved inside the workspace', async () => {
      const out = await propose(alex, 'proposeDealUpdate', {
        deal: 'Fleet telematics rollout',
        amount: 52000,
        expectedCloseDate: '2026-12-15',
        ownerName: 'Sam',
      });
      const sams = await prisma.user.findUniqueOrThrow({ where: { email: 'sam@northwind.test' } });
      expect(out.proposal).toMatchObject({
        kind: 'deal_update',
        title: 'Update deal',
        changes: [
          { field: 'amount', before: '$48,000', after: '$52,000' },
          { field: 'expectedCloseDate', after: 'Dec 15, 2026' },
          { field: 'owner', before: 'Alex Morgan', after: 'Sam Rivera' },
        ],
      });
      const row = await prisma.proposedAction.findUniqueOrThrow({
        where: { id: out.proposal.id },
      });
      expect(row.payload).toMatchObject({
        update: { amount: 52000, expectedCloseDate: '2026-12-15', ownerId: sams.id },
      });
    });

    it('proposes an activity on a company', async () => {
      const out = await propose(alex, 'proposeActivity', {
        type: 'NOTE',
        subject: 'Dana asked for revised pricing',
        companyName: 'Acme',
      });
      expect(out.proposal).toMatchObject({
        kind: 'activity',
        title: 'Log note',
        target: { label: 'Acme Logistics' },
        changes: [
          { field: 'type', before: null, after: 'Note' },
          { field: 'subject', before: null, after: 'Dana asked for revised pricing' },
        ],
      });
    });

    it.each([
      [
        'an invalid stage',
        'proposeDealStageChange',
        { deal: 'Acme', stage: 'CLOSING' },
        'invalid_arguments',
      ],
      [
        'a missing change',
        'proposeDealUpdate',
        { deal: 'Fleet telematics rollout' },
        'invalid_arguments',
      ],
      [
        'an unlinked activity',
        'proposeActivity',
        { type: 'NOTE', subject: 'x' },
        'invalid_arguments',
      ],
      [
        'an unknown deal',
        'proposeDealStageChange',
        { deal: 'Nonexistent', stage: 'WON' },
        'not_found',
      ],
      [
        'a no-op',
        'proposeDealStageChange',
        { deal: 'Fleet telematics rollout', stage: 'NEGOTIATION' },
        'no_change',
      ],
      [
        'an unknown owner',
        'proposeDealUpdate',
        { deal: 'Fleet telematics rollout', ownerName: 'Nobody' },
        'not_found',
      ],
    ])('rejects %s without storing anything', async (_label, name, input, error) => {
      const out = await tools.execute(alex, name, input);
      expect(out.ok).toBe(false);
      expect(out.data).toMatchObject({ error });
      expect(await prisma.proposedAction.count()).toBe(0);
    });

    it('cannot target another workspace: foreign deals, companies and owners are invisible', async () => {
      const foreignDeal = await prisma.deal.findFirstOrThrow({
        where: { workspaceId: jordan.scope.workspaceId },
      });
      const attempts = await Promise.all([
        tools.execute(alex, 'proposeDealStageChange', { deal: foreignDeal.title, stage: 'WON' }),
        tools.execute(alex, 'proposeActivity', {
          type: 'NOTE',
          subject: 'x',
          companyName: 'Orbit Telecom',
        }),
        tools.execute(alex, 'proposeDealUpdate', {
          deal: 'Fleet telematics rollout',
          ownerName: 'Jordan',
        }),
        tools.execute(alex, 'proposeDealStageChange', {
          deal: 'Fleet telematics rollout',
          stage: 'WON',
          workspaceId: jordan.scope.workspaceId,
        }),
      ]);
      expect(attempts.map((a) => (a.data as { error: string }).error)).toEqual([
        'not_found',
        'not_found',
        'not_found',
        'invalid_arguments',
      ]);
      expect(await prisma.proposedAction.count()).toBe(0);
    });
  });

  describe('deciding', () => {
    it('approve executes the change through the deal service and records the outcome', async () => {
      const { proposal } = await propose(alex, 'proposeDealStageChange', {
        deal: 'Fleet telematics rollout',
        stage: 'PROPOSAL',
      });
      const approved = await proposals.approve(alex.scope, proposal.id);

      expect(approved).toMatchObject({ status: 'approved', decidedAt: expect.any(String) });
      const deal = await dealByTitle('Fleet telematics rollout');
      expect(deal.stage).toBe('PROPOSAL');
      expect(Date.now() - deal.stageChangedAt.getTime()).toBeLessThan(60_000);
      expect(await notes(alex)).toEqual([
        'The user approved the proposal "Move deal to Proposal" (Fleet telematics rollout · Acme Logistics). The change has been applied.',
      ]);
    });

    it('approving an activity proposal creates the activity as the approving user', async () => {
      const { proposal } = await propose(alex, 'proposeActivity', {
        type: 'TASK',
        subject: 'Send revised order form',
        deal: 'Fleet telematics rollout',
      });
      await proposals.approve(alex.scope, proposal.id);
      const activity = await prisma.activity.findFirstOrThrow({
        where: { subject: 'Send revised order form' },
        include: { deal: true },
      });
      expect(activity).toMatchObject({
        type: 'TASK',
        authorId: alex.scope.userId,
        deal: { title: 'Fleet telematics rollout' },
      });
    });

    it('reject changes nothing and tells the model', async () => {
      const { proposal } = await propose(alex, 'proposeDealUpdate', {
        deal: 'Fleet telematics rollout',
        amount: 1,
      });
      expect(await proposals.reject(alex.scope, proposal.id)).toMatchObject({ status: 'rejected' });
      expect((await dealByTitle('Fleet telematics rollout')).amount).toBe(48000);
      expect((await notes(alex))[0]).toMatch(/^The user rejected the proposal/);
    });

    it('a proposal can be decided only once', async () => {
      const { proposal } = await propose(alex, 'proposeDealStageChange', {
        deal: 'Fleet telematics rollout',
        stage: 'PROPOSAL',
      });
      const results = await Promise.allSettled([
        proposals.approve(alex.scope, proposal.id),
        proposals.approve(alex.scope, proposal.id),
        proposals.reject(alex.scope, proposal.id),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason.getResponse()).toMatchObject({ code: 'proposal_not_pending' });
    });

    it('expired proposals cannot be approved', async () => {
      const { proposal } = await propose(alex, 'proposeDealStageChange', {
        deal: 'Fleet telematics rollout',
        stage: 'PROPOSAL',
      });
      await prisma.proposedAction.update({
        where: { id: proposal.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const err = await proposals.approve(alex.scope, proposal.id).catch((e: unknown) => e);
      expect((err as { getStatus(): number }).getStatus()).toBe(409);
      expect((err as { getResponse(): unknown }).getResponse()).toMatchObject({
        code: 'proposal_expired',
        proposal: { status: 'expired' },
      });
      expect((await dealByTitle('Fleet telematics rollout')).stage).toBe('NEGOTIATION');
      expect(
        (await prisma.proposedAction.findUniqueOrThrow({ where: { id: proposal.id } })).status,
      ).toBe('expired');
      expect((await notes(alex))[0]).toMatch(/expired before it was approved/);
    });

    it('refuses a stale proposal when the deal changed after it was proposed', async () => {
      const { proposal } = await propose(alex, 'proposeDealUpdate', {
        deal: 'Fleet telematics rollout',
        amount: 60000,
      });
      const deal = await dealByTitle('Fleet telematics rollout');
      // Someone edits the deal by hand in the meantime.
      await deals.update(sam.scope, deal.id, { amount: 50000 });

      const err = await proposals.approve(alex.scope, proposal.id).catch((e: unknown) => e);
      expect((err as { getResponse(): unknown }).getResponse()).toMatchObject({
        code: 'proposal_stale',
        proposal: {
          status: 'stale',
          resultMessage: 'the deal was modified after it was proposed',
        },
      });
      expect((await dealByTitle('Fleet telematics rollout')).amount).toBe(50000);
      expect((await notes(alex))[0]).toMatch(/was not applied: the deal was modified/);
    });

    it('approving one proposal makes a sibling proposal on the same deal stale', async () => {
      const first = await propose(alex, 'proposeDealStageChange', {
        deal: 'Fleet telematics rollout',
        stage: 'PROPOSAL',
      });
      const second = await propose(alex, 'proposeDealUpdate', {
        deal: 'Fleet telematics rollout',
        amount: 1,
      });
      await proposals.approve(alex.scope, first.proposal.id);
      await expect(proposals.approve(alex.scope, second.proposal.id)).rejects.toMatchObject({
        status: 409,
      });
      expect((await dealByTitle('Fleet telematics rollout')).amount).toBe(48000);
    });

    it('another user or workspace cannot approve or reject, and the proposal stays pending', async () => {
      const { proposal } = await propose(alex, 'proposeDealStageChange', {
        deal: 'Fleet telematics rollout',
        stage: 'WON',
      });
      for (const intruder of [sam, jordan]) {
        await expect(proposals.approve(intruder.scope, proposal.id)).rejects.toMatchObject({
          status: 404,
        });
        await expect(proposals.reject(intruder.scope, proposal.id)).rejects.toMatchObject({
          status: 404,
        });
      }
      const row = await prisma.proposedAction.findUniqueOrThrow({ where: { id: proposal.id } });
      expect(row.status).toBe('pending');
      expect((await dealByTitle('Fleet telematics rollout')).stage).toBe('NEGOTIATION');
    });
  });
});
