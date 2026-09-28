import { Controller, Get, Query } from '@nestjs/common';
import type { Contact } from '@crm/shared';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ContactsService } from './contacts.service';

@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('search') search?: string): Promise<Contact[]> {
    return this.contacts.list(user, { search });
  }
}
