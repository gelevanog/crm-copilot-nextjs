import { Injectable } from '@nestjs/common';
import type { Contact } from '@crm/shared';
import { PrismaService } from '../prisma/prisma.module';
import type { TenantScope } from '../common/tenant-scope';
import { contactInclude, toContact } from '../common/mappers';

@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(scope: TenantScope, opts: { search?: string } = {}): Promise<Contact[]> {
    const search = opts.search?.trim();
    const contacts = await this.prisma.contact.findMany({
      where: {
        workspaceId: scope.workspaceId,
        ...(search && {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { company: { name: { contains: search, mode: 'insensitive' } } },
          ],
        }),
      },
      include: contactInclude,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    return contacts.map(toContact);
  }
}
