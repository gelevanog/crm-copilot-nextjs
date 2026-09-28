import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  createActivityRequestSchema,
  type Activity,
  type CreateActivityRequest,
} from '@crm/shared';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ActivitiesService } from './activities.service';

@Controller('activities')
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId?: string,
    @Query('dealId') dealId?: string,
  ): Promise<Activity[]> {
    return this.activities.list(user, { companyId, dealId, limit: 50 });
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createActivityRequestSchema)) body: CreateActivityRequest,
  ): Promise<Activity> {
    return this.activities.create(user, body);
  }
}
