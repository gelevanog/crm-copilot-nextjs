import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../common/auth-user';
import { TokenBucketRateLimiter } from './token-bucket';

export const AI_RATE_LIMITER = Symbol('AI_RATE_LIMITER');

/**
 * Per-workspace token bucket in front of every LLM-backed endpoint, so one
 * tenant cannot exhaust the shared provider quota or budget.
 */
@Injectable()
export class AiRateLimitGuard implements CanActivate {
  constructor(@Inject(AI_RATE_LIMITER) private readonly limiter: TokenBucketRateLimiter) {}

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();

    const result = this.limiter.tryConsume(`ws:${request.user.workspaceId}`);
    response.setHeader('X-RateLimit-Limit', String(this.limiter.capacity));
    response.setHeader('X-RateLimit-Remaining', String(result.remaining));
    if (result.allowed) return true;

    const retryAfterSeconds = Math.ceil(result.retryAfterMs / 1000);
    response.setHeader('Retry-After', String(retryAfterSeconds));
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: 'rate_limited',
        message: `AI request limit reached for this workspace. Try again in ${retryAfterSeconds}s.`,
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
