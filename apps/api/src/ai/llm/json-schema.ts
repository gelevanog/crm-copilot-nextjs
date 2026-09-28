import { z } from 'zod';

/**
 * Converts a Zod schema into a plain JSON Schema object for tool definitions.
 * The Zod schema stays the runtime validator; the JSON Schema is only a hint
 * for the model.
 */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  // `io: 'input'` describes what the caller (the model) may send, e.g. fields
  // with defaults are optional.
  const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(schema, {
    io: 'input',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  return jsonSchema;
}
