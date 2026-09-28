import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Activity, ActivityType, CreateActivityRequest } from '@crm/shared';
import { PrismaService } from '../prisma/prisma.module';
import type { TenantScope } from '../common/tenant-scope';
import { activityInclude, daysAgo, toActivity } from '../common/mappers';

export interface ActivityQuery {
  companyId?: string;
  companyName?: string;
  dealId?: string;
  types?: ActivityType[];
  sinceDays?: number;
  limit?: number;
}

@Injectable()
export class ActivitiesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(scope: TenantScope, query: ActivityQuery = {}): Promise<Activity[]> {
    const where: Prisma.ActivityWhereInput = {
      workspaceId: scope.workspaceId,
      ...(query.companyId && { companyId: query.companyId }),
      ...(query.dealId && { dealId: query.dealId }),
      ...(query.companyName && {
        company: { name: { contains: query.companyName.trim(), mode: 'insensitive' } },
      }),
      ...(query.types && { type: { in: query.types } }),
      ...(query.sinceDays !== undefined && { occurredAt: { gte: daysAgo(query.sinceDays) } }),
    };
    const rows = await this.prisma.activity.findMany({
      where,
      include: activityInclude,
      orderBy: { occurredAt: 'desc' },
      take: Math.min(query.limit ?? 20, 100),
    });
    return rows.map(toActivity);
  }

  async create(scope: TenantScope, body: CreateActivityRequest): Promise<Activity> {
    let companyId = body.companyId ?? null;
    let contactId: string | null = null;

    // Linked records must belong to the caller's workspace.
    if (body.dealId) {
      const deal = await this.prisma.deal.findFirst({
        where: { id: body.dealId, workspaceId: scope.workspaceId },
        select: { companyId: true, contactId: true },
      });
      if (!deal) throw new BadRequestException('Unknown deal');
      companyId = deal.companyId;
      contactId = deal.contactId;
    } else if (companyId) {
      const company = await this.prisma.company.findFirst({
        where: { id: companyId, workspaceId: scope.workspaceId },
        select: { id: true },
      });
      if (!company) throw new BadRequestException('Unknown company');
    }

    const created = await this.prisma.activity.create({
      data: {
        workspaceId: scope.workspaceId,
        authorId: scope.userId,
        type: body.type,
        subject: body.subject,
        body: body.body ?? null,
        occurredAt: new Date(),
        dealId: body.dealId ?? null,
        companyId,
        contactId,
      },
      include: activityInclude,
    });
    return toActivity(created);
  }
}
