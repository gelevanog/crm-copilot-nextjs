import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import type { ProposedActionView } from '@crm/shared';
import { CurrentUser, type AuthUser } from '../../common/auth-user';
import { ProposedActionsService } from './proposed-actions.service';

/**
 * The only way a proposed change is executed: an explicit, authenticated call
 * by the user who received the proposal. The model has no route to this.
 * Conflicts (expired, stale, already decided) are 409s whose body carries the
 * current `proposal`, so the UI can update the card.
 */
@Controller('ai/actions')
export class ProposedActionsController {
  constructor(private readonly actions: ProposedActionsService) {}

  @Post(':id/approve')
  @HttpCode(200)
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<ProposedActionView> {
    return this.actions.approve(user, id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<ProposedActionView> {
    return this.actions.reject(user, id);
  }
}
