import { Injectable, NotFoundException } from '@nestjs/common';
import type { Conversation } from '@prisma/client';
import type { ConversationDetail, ConversationSummary } from '@crm/shared';
import type { TenantScope } from '../../common/tenant-scope';
import { PrismaService } from '../../prisma/prisma.module';
import { toProposalView } from '../actions/proposal-view';
import type { ConversationItem } from '../llm/llm.types';
import { fitToContextWindow } from './context-window';
import {
  fromRow,
  toChatTurns,
  toModelItems,
  toRow,
  titleFromQuestion,
  type TranscriptEntry,
} from './transcript';

const LIST_LIMIT = 50;
/** Upper bound on rows loaded to build the model context (trimming does the rest). */
const MAX_CONTEXT_ROWS = 400;

function toSummary(c: Conversation): ConversationSummary {
  return {
    id: c.id,
    title: c.title,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/**
 * Saved copilot conversations. A conversation belongs to one user in one
 * workspace: every query filters on both, so another user (even in the same
 * workspace) gets a 404, exactly like a record that does not exist.
 */
@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(scope: TenantScope): Promise<ConversationSummary[]> {
    const rows = await this.prisma.conversation.findMany({
      where: { workspaceId: scope.workspaceId, userId: scope.userId },
      orderBy: { updatedAt: 'desc' },
      take: LIST_LIMIT,
    });
    return rows.map(toSummary);
  }

  async create(scope: TenantScope, firstQuestion: string): Promise<ConversationSummary> {
    const row = await this.prisma.conversation.create({
      data: {
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        title: titleFromQuestion(firstQuestion),
      },
    });
    return toSummary(row);
  }

  async get(scope: TenantScope, id: string): Promise<ConversationSummary> {
    return toSummary(await this.findOwned(scope, id));
  }

  async detail(scope: TenantScope, id: string): Promise<ConversationDetail> {
    const conversation = await this.findOwned(scope, id);
    const [messages, proposals] = await Promise.all([
      this.prisma.conversationMessage.findMany({
        where: { conversationId: conversation.id },
        orderBy: { seq: 'asc' },
      }),
      this.prisma.proposedAction.findMany({
        where: {
          conversationId: conversation.id,
          workspaceId: scope.workspaceId,
          userId: scope.userId,
        },
      }),
    ]);
    const now = new Date();
    return {
      ...toSummary(conversation),
      turns: toChatTurns(
        messages.map((m) => ({ id: m.id, entry: fromRow(m) })),
        new Map(proposals.map((p) => [p.id, toProposalView(p, now)])),
      ),
    };
  }

  async rename(scope: TenantScope, id: string, title: string): Promise<ConversationSummary> {
    await this.findOwned(scope, id);
    return toSummary(await this.prisma.conversation.update({ where: { id }, data: { title } }));
  }

  async remove(scope: TenantScope, id: string): Promise<void> {
    const { count } = await this.prisma.conversation.deleteMany({
      where: { id, workspaceId: scope.workspaceId, userId: scope.userId },
    });
    if (count === 0) throw new NotFoundException('Conversation not found');
  }

  /**
   * Appends entries in order. Sequence numbers are reserved by incrementing
   * `messageCount` under the conversation's row lock, so concurrent appends
   * (e.g. an approval note while an answer streams) never collide.
   */
  async append(scope: TenantScope, id: string, entries: TranscriptEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.conversation.updateMany({
        where: { id, workspaceId: scope.workspaceId, userId: scope.userId },
        data: { messageCount: { increment: entries.length } },
      });
      if (count === 0) throw new NotFoundException('Conversation not found');
      const { messageCount } = await tx.conversation.findUniqueOrThrow({
        where: { id },
        select: { messageCount: true },
      });
      const first = messageCount - entries.length;
      await tx.conversationMessage.createMany({
        data: entries.map((entry, i) => ({ conversationId: id, seq: first + i, ...toRow(entry) })),
      });
    });
  }

  /** History for the next model call, trimmed to the estimated-token budget. */
  async modelContext(
    scope: TenantScope,
    id: string,
    maxTokens: number,
  ): Promise<ConversationItem[]> {
    const conversation = await this.findOwned(scope, id);
    const rows = await this.prisma.conversationMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { seq: 'desc' },
      take: MAX_CONTEXT_ROWS,
    });
    const entries = rows.reverse().map(fromRow);
    const fitted = fitToContextWindow(entries, maxTokens, {
      olderOmitted: conversation.messageCount > rows.length,
    });
    return toModelItems(fitted.entries);
  }

  private async findOwned(scope: TenantScope, id: string): Promise<Conversation> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, workspaceId: scope.workspaceId, userId: scope.userId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }
}
