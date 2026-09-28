import { BadRequestException, Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import {
  parseDealFilterParams,
  updateDealRequestSchema,
  type DealDetail,
  type DealListItem,
  type Paginated,
  type PipelineStats,
  type UpdateDealRequest,
} from '@crm/shared';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DealsService } from './deals.service';

@Controller()
export class DealsController {
  constructor(private readonly deals: DealsService) {}

  @Get('deals')
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: Record<string, string | string[] | undefined>,
  ): Promise<Paginated<DealListItem>> {
    const filter = parseDealFilterParams(query);
    if (!filter.success) {
      throw new BadRequestException({
        message: 'Invalid filter',
        issues: filter.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return this.deals.search(user, filter.data);
  }

  @Get('deals/:id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<DealDetail> {
    return this.deals.findOne(user, id);
  }

  @Patch('deals/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateDealRequestSchema)) body: UpdateDealRequest,
  ): Promise<DealDetail> {
    return this.deals.update(user, id, body);
  }

  @Get('pipeline/stats')
  stats(
    @CurrentUser() user: AuthUser,
    @Query('ownedByMe') ownedByMe?: string,
  ): Promise<PipelineStats> {
    return this.deals.pipelineStats(user, { ownedByMe: ownedByMe === 'true' });
  }
}
