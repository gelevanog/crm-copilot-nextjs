import { Controller, Get, Param } from '@nestjs/common';
import type { CompanyDetail, CompanyListItem } from '@crm/shared';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { CompaniesService } from './companies.service';

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<CompanyListItem[]> {
    return this.companies.list(user);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<CompanyDetail> {
    return this.companies.findOne(user, id);
  }
}
