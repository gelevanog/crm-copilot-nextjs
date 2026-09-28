import { Injectable, NotFoundException } from '@nestjs/common';
import type { Company } from '@prisma/client';
import { OPEN_DEAL_STAGES, type CompanyDetail, type CompanyListItem } from '@crm/shared';
import { PrismaService } from '../prisma/prisma.module';
import type { TenantScope } from '../common/tenant-scope';
import {
  activityInclude,
  contactInclude,
  dealListInclude,
  toActivity,
  toContact,
  toDealListItem,
} from '../common/mappers';

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(scope: TenantScope): Promise<CompanyListItem[]> {
    const companies = await this.prisma.company.findMany({
      where: { workspaceId: scope.workspaceId },
      orderBy: { name: 'asc' },
    });
    return this.withAggregates(scope, companies);
  }

  async findOne(scope: TenantScope, id: string): Promise<CompanyDetail> {
    const company = await this.prisma.company.findFirst({
      where: { id, workspaceId: scope.workspaceId },
    });
    if (!company) throw new NotFoundException('Company not found');
    return this.toDetail(scope, company);
  }

  /**
   * Resolves a (possibly partial) company name inside the caller's workspace.
   * Exact case-insensitive matches win over partial matches.
   */
  async findByName(scope: TenantScope, name: string): Promise<CompanyDetail | null> {
    const candidates = await this.prisma.company.findMany({
      where: {
        workspaceId: scope.workspaceId,
        name: { contains: name.trim(), mode: 'insensitive' },
      },
      orderBy: { name: 'asc' },
      take: 10,
    });
    const exact = candidates.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
    const match = exact ?? candidates[0];
    return match ? this.toDetail(scope, match) : null;
  }

  private async toDetail(scope: TenantScope, company: Company): Promise<CompanyDetail> {
    const where = { workspaceId: scope.workspaceId, companyId: company.id };
    const [[aggregates], contacts, deals, activities] = await Promise.all([
      this.withAggregates(scope, [company]),
      this.prisma.contact.findMany({
        where,
        include: contactInclude,
        orderBy: { lastName: 'asc' },
      }),
      this.prisma.deal.findMany({ where, include: dealListInclude, orderBy: { amount: 'desc' } }),
      this.prisma.activity.findMany({
        where,
        include: activityInclude,
        orderBy: { occurredAt: 'desc' },
        take: 30,
      }),
    ]);
    return {
      ...(aggregates as CompanyListItem),
      contacts: contacts.map(toContact),
      deals: deals.map((d) => toDealListItem(d)),
      activities: activities.map(toActivity),
    };
  }

  private async withAggregates(
    scope: TenantScope,
    companies: Company[],
  ): Promise<CompanyListItem[]> {
    const ids = companies.map((c) => c.id);
    const [pipeline, lastActivity] = await Promise.all([
      this.prisma.deal.groupBy({
        by: ['companyId'],
        where: {
          workspaceId: scope.workspaceId,
          companyId: { in: ids },
          stage: { in: [...OPEN_DEAL_STAGES] },
        },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.activity.groupBy({
        by: ['companyId'],
        where: { workspaceId: scope.workspaceId, companyId: { in: ids } },
        _max: { occurredAt: true },
      }),
    ]);
    return companies.map((c) => {
      const p = pipeline.find((row) => row.companyId === c.id);
      const a = lastActivity.find((row) => row.companyId === c.id);
      return {
        id: c.id,
        name: c.name,
        domain: c.domain,
        industry: c.industry,
        employees: c.employees,
        city: c.city,
        country: c.country,
        openDeals: p?._count._all ?? 0,
        openPipeline: p?._sum.amount ?? 0,
        lastActivityAt: a?._max.occurredAt?.toISOString() ?? null,
      };
    });
  }
}
