export type LlmErrorCode =
  | 'provider_auth'
  | 'provider_rate_limited'
  | 'provider_unavailable'
  | 'provider_bad_request'
  | 'invalid_model_output'
  | 'model_refused'
  | 'output_truncated'
  | 'aborted';

const HTTP_STATUS: Record<LlmErrorCode, number> = {
  provider_auth: 502,
  provider_rate_limited: 503,
  provider_unavailable: 503,
  provider_bad_request: 502,
  invalid_model_output: 502,
  model_refused: 422,
  output_truncated: 502,
  aborted: 499,
};

const PUBLIC_MESSAGE: Record<LlmErrorCode, string> = {
  provider_auth: 'The AI provider rejected our credentials. Please contact the administrator.',
  provider_rate_limited: 'The AI provider is busy right now. Please try again in a moment.',
  provider_unavailable: 'The AI provider is temporarily unavailable. Please try again.',
  provider_bad_request: 'The AI request could not be processed.',
  invalid_model_output:
    'The AI returned an answer we could not validate. Please rephrase and retry.',
  model_refused: 'The AI declined to answer this request.',
  output_truncated: 'The AI answer was cut off. Please try a narrower request.',
  aborted: 'The request was cancelled.',
};

/** Normalised error thrown by every provider; safe to show `publicMessage` to end users. */
export class LlmError extends Error {
  readonly httpStatus: number;
  readonly publicMessage: string;

  constructor(
    readonly code: LlmErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'LlmError';
    this.httpStatus = HTTP_STATUS[code];
    this.publicMessage = PUBLIC_MESSAGE[code];
  }
}
