/** Tests never touch the dev database: they use TEST_DATABASE_URL (see README > Testing). */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://crm:crm@localhost:5433/crm_test?schema=public';
