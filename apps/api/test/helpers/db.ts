import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { TEST_DATABASE_URL } from './db-url';

let available: boolean | undefined;

/**
 * Applies migrations to the test database once per file. Returns false (and
 * the DB-backed suites are skipped) when no Postgres is reachable, so unit
 * tests still run on a machine without Docker.
 */
export async function prepareTestDatabase(): Promise<boolean> {
  if (available !== undefined) return available;
  const prisma = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });
  try {
    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
      stdio: 'pipe',
    });
    await prisma.$queryRaw`SELECT 1`;
    available = true;
  } catch (err) {
    console.warn(
      `[test] Postgres not reachable at TEST_DATABASE_URL, skipping DB-backed tests: ${(err as Error).message.split('\n')[0]}`,
    );
    available = false;
  } finally {
    await prisma.$disconnect();
  }
  return available;
}

export function createTestPrisma(): PrismaClient {
  return new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });
}
