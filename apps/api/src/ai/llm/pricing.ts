import type { TokenUsage } from './llm.types';

/** USD per 1M tokens. Keep in sync with your provider contract. */
interface Price {
  input: number;
  output: number;
}

const PRICES: Record<string, Price> = {
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'gpt-5': { input: 1.25, output: 10 },
  'gpt-5-mini': { input: 0.25, output: 2 },
  'gpt-5-nano': { input: 0.05, output: 0.4 },
  'fake-rules-v1': { input: 0, output: 0 },
};

/** Anthropic prompt-cache multipliers relative to the base input price. */
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

export interface PriceOverride {
  inputPerMTok?: number;
  outputPerMTok?: number;
}

export function priceFor(model: string, override: PriceOverride = {}): Price | null {
  if (override.inputPerMTok !== undefined && override.outputPerMTok !== undefined) {
    return { input: override.inputPerMTok, output: override.outputPerMTok };
  }
  return PRICES[model] ?? null;
}

/** Estimated cost in USD, or 0 when the model is not in the table (logged by the caller). */
export function estimateCostUsd(
  model: string,
  usage: TokenUsage,
  override?: PriceOverride,
): number {
  const price = priceFor(model, override);
  if (!price) return 0;
  const inputCost =
    usage.inputTokens * price.input +
    usage.cacheReadTokens * price.input * CACHE_READ_MULTIPLIER +
    usage.cacheWriteTokens * price.input * CACHE_WRITE_MULTIPLIER;
  const outputCost = usage.outputTokens * price.output;
  return Math.round(((inputCost + outputCost) / 1_000_000) * 1e6) / 1e6;
}
