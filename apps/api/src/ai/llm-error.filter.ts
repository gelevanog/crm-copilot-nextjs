import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { LlmError } from './llm/llm-error';

/** Maps provider/validation failures of the smart actions to clean HTTP errors. */
@Catch(LlmError)
export class LlmErrorFilter implements ExceptionFilter {
  catch(error: LlmError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(error.httpStatus).json({
      statusCode: error.httpStatus,
      code: error.code,
      message: error.publicMessage,
    });
  }
}
