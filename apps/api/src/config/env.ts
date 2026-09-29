import { z } from 'zod';

const booleanish = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

/** "a, b ,c" -> ["a", "b", "c"]; empty -> [] */
const commaList = z.string().transform((v) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    LOG_PRETTY: booleanish.default(false),
    CORS_ORIGIN: z.string().default('http://localhost:3000'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
    JWT_TTL_SECONDS: z.coerce.number().int().positive().default(43_200),

    LLM_PROVIDER: z.enum(['fake', 'openai', 'anthropic', 'openrouter']).default('fake'),
    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_MODEL: z.string().default('claude-sonnet-5'),
    ANTHROPIC_EFFORT: z.enum(['low', 'medium', 'high']).default('medium'),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_MODEL: z.string().default('gpt-5-mini'),
    OPENAI_BASE_URL: z.url().optional(),
    /** OpenRouter (OpenAI-compatible Chat Completions API, many free models). */
    OPENROUTER_API_KEY: z.string().optional(),
    OPENROUTER_MODEL: z.string().default('nvidia/nemotron-3-super-120b-a12b:free'),
    /** Tried in order by OpenRouter when the primary model is unavailable or rate limited. */
    OPENROUTER_FALLBACK_MODELS: commaList
      .pipe(
        z
          .array(z.string())
          .max(2, 'OpenRouter accepts at most 2 fallback models (3 models per request)'),
      )
      .default([]),
    OPENROUTER_BASE_URL: z.url().default('https://openrouter.ai/api/v1'),
    /** Optional app attribution headers (HTTP-Referer, X-Title). */
    OPENROUTER_APP_URL: z.url().optional(),
    OPENROUTER_APP_TITLE: z.string().min(1).optional(),
    LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
    LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(4096),
    /** SDK retries for 429 / 5xx / connection errors (exponential backoff, honours Retry-After). */
    LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(2),
    /** Minimum gap between model requests (e.g. 3000 for free-tier rate limits). 0 = off. */
    LLM_MIN_REQUEST_INTERVAL_MS: z.coerce.number().int().nonnegative().default(0),
    /** Optional price override (USD per 1M tokens) for models missing from the built-in table. */
    LLM_PRICE_INPUT_PER_MTOK: z.coerce.number().nonnegative().optional(),
    LLM_PRICE_OUTPUT_PER_MTOK: z.coerce.number().nonnegative().optional(),

    AI_MAX_TOOL_ITERATIONS: z.coerce.number().int().min(1).max(10).default(5),
    /** Estimated-token budget for the conversation history sent to the model. */
    AI_CONTEXT_MAX_TOKENS: z.coerce.number().int().min(1000).default(24_000),
    /** Minutes a proposed write action stays approvable. */
    AI_PROPOSAL_TTL_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    AI_RATE_LIMIT_CAPACITY: z.coerce.number().int().positive().default(20),
    AI_RATE_LIMIT_REFILL_PER_MINUTE: z.coerce.number().positive().default(10),
  })
  .superRefine((env, ctx) => {
    if (env.LLM_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['ANTHROPIC_API_KEY'],
        message: 'ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic',
      });
    }
    if (env.LLM_PROVIDER === 'openrouter' && !env.OPENROUTER_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['OPENROUTER_API_KEY'],
        message: 'OPENROUTER_API_KEY is required when LLM_PROVIDER=openrouter',
      });
    }
    if (env.LLM_PROVIDER === 'openai' && !env.OPENAI_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['OPENAI_API_KEY'],
        message: 'OPENAI_API_KEY is required when LLM_PROVIDER=openai',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Validates `process.env` once at startup and fails fast with a readable message. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return result.data;
}

/**
 * Loads `.env` from the working directory for local development, if present.
 * Existing environment variables (Docker, CI) always take precedence.
 */
export function loadDotEnvFile(path = '.env'): void {
  try {
    process.loadEnvFile(path);
  } catch {
    // No .env file: rely on the real environment.
  }
}
