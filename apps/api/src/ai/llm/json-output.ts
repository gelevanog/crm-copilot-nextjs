import { LlmError } from './llm-error';

/**
 * Parses a model's JSON answer. Models without native structured outputs
 * (many open-weight models behind OpenRouter) sometimes wrap the object in a
 * Markdown fence or add a sentence around it; this accepts those shapes. The
 * result is still validated against the Zod schema by the caller.
 */
export function parseModelJson(content: string): unknown {
  const text = content.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const braces =
    text.indexOf('{') !== -1 ? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1) : undefined;
  for (const candidate of [text, fenced, braces]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // try the next shape
    }
  }
  throw new LlmError('invalid_model_output', 'Model returned non-JSON content');
}
