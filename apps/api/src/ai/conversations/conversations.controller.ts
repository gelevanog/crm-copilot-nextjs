import { Body, Controller, Delete, Get, HttpCode, Param, Patch } from '@nestjs/common';
import {
  renameConversationRequestSchema,
  type ConversationDetail,
  type ConversationSummary,
  type RenameConversationRequest,
} from '@crm/shared';
import { CurrentUser, type AuthUser } from '../../common/auth-user';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ConversationsService } from './conversations.service';

@Controller('ai/conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<ConversationSummary[]> {
    return this.conversations.list(user);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<ConversationDetail> {
    return this.conversations.detail(user, id);
  }

  @Patch(':id')
  rename(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(renameConversationRequestSchema)) body: RenameConversationRequest,
  ): Promise<ConversationSummary> {
    return this.conversations.rename(user, id, body.title);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    return this.conversations.remove(user, id);
  }
}
