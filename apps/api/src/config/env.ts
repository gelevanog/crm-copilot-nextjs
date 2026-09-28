import { z } from 'zod';

const booleanish = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

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

    LLM_PROVIDER: z.enum(['fake', 'openai', 'anthropic']).default('fake'),
    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_MODEL: z.string().default('claude-sonnet-5'),
    ANTHROPIC_EFFORT: z.enum(['low', 'medium', 'high']).default('medium'),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_MODEL: z.string().default('gpt-5-mini'),
    OPENAI_BASE_URL: z.url().optional(),
    LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
    LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(4096),
    /** Optional price override (USD per 1M tokens) for models missing from the built-in table. */
    LLM_PRICE_INPUT_PER_MTOK: z.coerce.number().nonnegative().optional(),
    LLM_PRICE_OUTPUT_PER_MTOK: z.coerce.number().nonnegative().optional(),

    AI_MAX_TOOL_ITERATIONS: z.coerce.number().int().min(1).max(10).default(5),
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
