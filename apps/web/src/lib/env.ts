import 'server-only';
import { z } from 'zod';

const schema = z.object({
  /** Base URL of the NestJS API as seen from the Next.js server (not the browser). */
  API_URL: z.url().default('http://localhost:4000'),
  /** Set to true when the app is served over HTTPS. */
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export const env = schema.parse({
  API_URL: process.env.API_URL,
  COOKIE_SECURE: process.env.COOKIE_SECURE,
});
