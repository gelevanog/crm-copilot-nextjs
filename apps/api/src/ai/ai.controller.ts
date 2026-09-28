import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  chatRequestSchema,
  followUpRequestSchema,
  parseFilterRequestSchema,
  type AiUsageReport,
  type ChatRequest,
  type ChatStreamEvent,
  type FollowUpEmail,
  type FollowUpRequest,
  type NotesSummary,
  type ParseFilterRequest,
  type ParsedFilter,
} from '@crm/shared';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AiService } from './ai.service';
import { AiRateLimitGuard } from './rate-limit/ai-rate-limit.guard';
import { UsageService } from './usage/usage.service';

@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly usage: UsageService,
  ) {}

  /** Streams newline-delimited JSON `ChatStreamEvent`s. */
  @Post('chat')
  @UseGuards(AiRateLimitGuard)
  async chat(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(chatRequestSchema)) body: ChatRequest,
    @Res() res: Response,
  ): Promise<void> {
    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Stop spending tokens if the client goes away mid-answer.
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) abort.abort();
    });
    const emit = (event: ChatStreamEvent) => {
      if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
    };

    await this.ai.chat(user, body.messages, emit, abort.signal);
    res.end();
  }

  @Post('deals/:id/follow-up')
  @HttpCode(200)
  @UseGuards(AiRateLimitGuard)
  followUp(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(followUpRequestSchema)) body: FollowUpRequest,
  ): Promise<FollowUpEmail> {
    return this.ai.draftFollowUp(user, id, body.tone);
  }

  @Post('companies/:id/summary')
  @HttpCode(200)
  @UseGuards(AiRateLimitGuard)
  summarize(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<NotesSummary> {
    return this.ai.summarizeCompany(user, id);
  }

  @Post('parse-filter')
  @HttpCode(200)
  @UseGuards(AiRateLimitGuard)
  parseFilter(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(parseFilterRequestSchema)) body: ParseFilterRequest,
  ): Promise<ParsedFilter> {
    return this.ai.parseDealFilter(user, body.text);
  }

  @Get('usage')
  report(@CurrentUser() user: AuthUser, @Query('days') days?: string): Promise<AiUsageReport> {
    const periodDays = Math.min(90, Math.max(1, Number(days) || 14));
    return this.usage.report(user, periodDays);
  }
}
